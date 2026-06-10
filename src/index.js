import {
    S3Client,
    GetObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
    SESClient,
    SendEmailCommand,
    SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import { simpleParser } from "mailparser";
import { buffer } from "stream/consumers";
import nodemailer from "nodemailer";

const FORWARDER_EMAIL = process.env.FORWARDER_EMAIL;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;
const MAIL_BUCKET = process.env.MAIL_BUCKET;

if (!MAIL_BUCKET || !FORWARDER_EMAIL || !RECIPIENT_EMAIL) {
    console.error(
        JSON.stringify({
            level: "CRITICAL",
            message: "Missing required environment variables",
            hasBucket: !!MAIL_BUCKET,
            hasForwarder: !!FORWARDER_EMAIL,
            hasRecipient: !!RECIPIENT_EMAIL,
        }),
    );
    process.exit(1);
}

const s3Client = new S3Client({ region: "ap-south-1" });
const sesClient = new SESClient({ region: "ap-south-1" });

export const handler = async (event) => {
    // Pull message from S3
    const { messageId } = event.Records[0].ses.mail;
    console.log(
        JSON.stringify({
            level: "INFO",
            message: "Processing forwarding email.",
            messageId,
        }),
    );
    const [mailRaw, fetchError] = await getEmailFromS3(messageId);
    if (fetchError) {
        await sendErrorEmail(
            "Failed S3 Fetch - MailProcessor",
            `S3 email fetch failed for messageId: ${messageId}.\r\nError Object: ${JSON.stringify(serializeError(fetchError))}`,
            messageId,
        );
        return {
            status: "failed",
            stage: "s3-fetch",
            error: fetchError.message,
        };
    }

    // Parse email
    const parsedEmail = await simpleParser(Buffer.from(mailRaw));
    const originalSenderEmail =
        parsedEmail.from?.value[0]?.address || "unknown@domain.com";
    const originalSenderName = parsedEmail.from?.value[0]?.name || "NO-NAME";
    const originalSubject = parsedEmail.subject || "";

    // Construct Raw Buffer for SES
    const newFromHeader = `${originalSenderName} ${originalSenderEmail} <${FORWARDER_EMAIL}>`;
    const mailOptions = {
        from: newFromHeader,
        to: RECIPIENT_EMAIL,
        replyTo: originalSenderEmail,
        subject: originalSubject,
        text: parsedEmail.text,
        html: parsedEmail.html,
        attachments: parsedEmail.attachments.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
        })),
    };
    const transporter = nodemailer.createTransport({ streamTransport: true });
    const compiledMime = await transporter.sendMail(mailOptions);
    const rawMessageBuffer = await buffer(compiledMime.message);

    const [, sendError] = await sendRaw(rawMessageBuffer, messageId);
    if (sendError) {
        await sendErrorEmail(
            "Failed Forward - MailProcessor",
            `Error forwarding for messageId:${messageId}.\r\nError Object: ${JSON.stringify(sendError)}`,
            messageId,
        );
        return {
            status: "failed",
            stage: "parse-and-forward",
            error: sendError.message,
        };
    }

    console.log(
        JSON.stringify({
            level: "INFO",
            message: "Forwarded successfully.",
            messageId,
        }),
    );

    const [, deleteError] = await deleteEmailFromS3(messageId);
    if (deleteError) {
        console.log(
            JSON.stringify({
                level: "ERROR",
                message: "Failed to delete email from S3.",
                messageId,
            }),
        );
        return {
            status: "success",
            forwardedFor: originalSenderEmail,
            issues: [{ message: "Failed to delete email from S3." }],
        };
    }
    return { status: "success", forwardedFor: originalSenderEmail };
};

async function getEmailFromS3(messageId) {
    const command = new GetObjectCommand({
        Bucket: MAIL_BUCKET,
        Key: messageId,
    });

    try {
        const res = await s3Client.send(command);
        const objectBytes = await res.Body.transformToByteArray();
        return [objectBytes, null];
    } catch (e) {
        console.error(
            JSON.stringify({
                level: "ERROR",
                message: "Failed to fetch email from S3.",
                messageId,
                error: serializeError(e),
            }),
        );
        return [null, e];
    }
}

async function deleteEmailFromS3(messageId) {
    const command = new DeleteObjectCommand({
        Bucket: MAIL_BUCKET,
        Key: messageId,
    });

    try {
        const res = await s3Client.send(command);
        return [res, null];
    } catch (e) {
        console.error(
            JSON.stringify({
                level: "ERROR",
                message: "Failed to delete mail from S3.",
                messageId,
                error: serializeError(e),
            }),
        );
        return [null, e];
    }
}

async function sendErrorEmail(subject, body, messageId) {
    const params = {
        Source: FORWARDER_EMAIL,
        Destination: {
            ToAddresses: [RECIPIENT_EMAIL],
        },
        Message: {
            Subject: {
                Data: subject,
                Charset: "UTF-8",
            },
            Body: {
                Text: {
                    Data: body,
                    Charset: "UTF-8",
                },
            },
        },
    };

    try {
        const command = new SendEmailCommand(params);
        const res = await sesClient.send(command);
        return [res, null];
    } catch (e) {
        console.error(
            JSON.stringify({
                level: "CRITICAL",
                message: "Failed to send alert/error email via SES.",
                messageId,
                error: serializeError(e),
            }),
        );
        return [null, e];
    }
}

async function sendRaw(message, messageId) {
    try {
        const res = await sesClient.send(
            new SendRawEmailCommand({
                RawMessage: {
                    Data: message,
                },
            }),
        );

        return [res, null];
    } catch (e) {
        console.error(
            JSON.stringify({
                level: "ERROR",
                message: "Failed to forward raw email via SES.",
                messageId,
                error: serializeError(e),
            }),
        );
        return [null, e];
    }
}

function serializeError(err) {
    if (err instanceof Error) {
        return {
            message: err.message,
            stack: err.stack,
            ...err,
        };
    }
    return err;
}
