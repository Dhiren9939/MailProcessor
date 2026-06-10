# MailProcessor

MailProcessor is an AWS Lambda email forwarder for SES inbound mail. SES stores the original raw message in S3, invokes this Lambda with the SES event, and the function forwards the message to a configured recipient with the original sender set as `Reply-To`.

## What It Does

- Reads the SES `messageId` from the Lambda event.
- Fetches the raw email from an S3 bucket using that `messageId` as the object key.
- Parses the message with `mailparser`.
- Rebuilds the message with `nodemailer`, preserving subject, text, HTML, and attachments.
- Sends the forwarded email through Amazon SES.
- Deletes the processed raw email from S3 after a successful forward.
- Sends an SES alert email when S3 fetch or forwarding fails.

## Project Structure

```text
.
|-- Dockerfile
|-- README.md
|-- eslint.config.js
|-- examples
|   |-- env.example
|   |-- sample-email.eml
|   `-- ses-event.json
|-- package.json
`-- src
    `-- index.js
```

## Requirements

- Node.js 24 or a compatible Lambda runtime
- npm
- Docker, for local Lambda container testing
- AWS account with SES receiving and sending enabled
- S3 bucket for inbound SES messages
- Verified SES identity for `FORWARDER_EMAIL`

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `MAIL_BUCKET` | Yes | S3 bucket where SES stores inbound raw email objects. |
| `FORWARDER_EMAIL` | Yes | Verified SES address used as the envelope/from address for forwarded mail. |
| `RECIPIENT_EMAIL` | Yes | Destination address that receives forwarded mail and error alerts. |

See [examples/env.example](examples/env.example) for a copyable template.

## Install

```bash
npm install
```

## Lint

```bash
npm run lint
```

On Windows PowerShell, use this if script execution policy blocks `npm.ps1`:

```powershell
npm.cmd run lint
```

## Build

Create a deployable `dist` folder:

```bash
npm run build
```

On Windows PowerShell, use this if script execution policy blocks `npm.ps1`:

```powershell
npm.cmd run build
```

The build copies `src/index.js` to `dist/index.js`, copies `package.json` and `package-lock.json`, then installs production dependencies into `dist/node_modules`.

## AWS Setup

1. Verify `FORWARDER_EMAIL` or its domain in SES.
2. Enable SES receiving for the inbound domain.
3. Create an S3 bucket for raw inbound messages.
4. Add an SES receipt rule that stores messages in the bucket and invokes this Lambda.
5. Give the Lambda role permissions to:
   - `s3:GetObject` on `arn:aws:s3:::<MAIL_BUCKET>/*`
   - `s3:DeleteObject` on `arn:aws:s3:::<MAIL_BUCKET>/*`
   - `ses:SendRawEmail`
   - `ses:SendEmail`

## Local Docker Test

Build the Lambda container:

```bash
docker build -t mailprocessor:local .
```

Run it with placeholder values replaced by your real AWS/S3/SES configuration:

```bash
docker run --rm -p 9000:8080 \
  -e AWS_ACCESS_KEY_ID=replace-me \
  -e AWS_SECRET_ACCESS_KEY=replace-me \
  -e AWS_DEFAULT_REGION=ap-south-1 \
  -e FORWARDER_EMAIL=forwarder@example.com \
  -e RECIPIENT_EMAIL=recipient@example.com \
  -e MAIL_BUCKET=my-ses-mail-bucket \
  mailprocessor:local
```

In another terminal, upload the sample email using the same key as the event `messageId`:

```bash
aws s3 cp examples/sample-email.eml s3://my-ses-mail-bucket/example-message-id
```

Invoke the running Lambda container:

```bash
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  --data-binary @examples/ses-event.json
```

Expected success response:

```json
{
  "status": "success",
  "forwardedFor": "sender@example.com"
}
```

## Example Event

The Lambda expects the SES event shape used in [examples/ses-event.json](examples/ses-event.json). The important field is:

```json
{
  "Records": [
    {
      "ses": {
        "mail": {
          "messageId": "example-message-id"
        }
      }
    }
  ]
}
```

That `messageId` must match the S3 object key containing the raw email.

## Operational Notes

- The AWS clients in [src/index.js](src/index.js) use `ap-south-1`.
- SES sandbox accounts can only send to verified recipients. Move SES out of sandbox or verify `RECIPIENT_EMAIL`.
- The local and example Lambda timeout is 10 seconds. Increase it if you forward large messages or attachments.
- After a successful forward, the raw S3 object is deleted.
- If deletion fails after forwarding, the handler still returns `status: "success"` with an `issues` array.

## Security Notes

- Do not commit AWS access keys or real email credentials.
- Prefer IAM roles for deployed Lambda.
- For local testing, use short-lived credentials or an AWS profile instead of hard-coded keys.
- Rotate any credentials that were ever committed or shared outside a secure secret manager.
