# Examples

This folder contains safe, placeholder-based examples for local and manual testing.

## Files

- [env.example](env.example): Required environment variables for the Lambda.
- [ses-event.json](ses-event.json): Sample SES Lambda event with `messageId` set to `example-message-id`.
- [sample-email.eml](sample-email.eml): Raw email content that can be uploaded to S3 using the same key.

## Manual Test Flow

1. Start the Lambda container as described in the root [README](../README.md).
2. Upload the sample email to your configured bucket:

```bash
aws s3 cp examples/sample-email.eml s3://my-ses-mail-bucket/example-message-id
```

3. Invoke the local Lambda container:

```bash
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  --data-binary @examples/ses-event.json
```

The event `messageId` and S3 object key must match.
