# Ignite Bulk Uploader

Lightweight web app to upload up to 10 videos at a time to Ignite Video Cloud.

Features:

- Per-file progress bars using axios upload progress
- Set each video title to the file name automatically
- Select visibility (private/public) for all uploads
- Configurable API Base URL and API token (both persisted locally)
- Poll processing status every 10 seconds after upload

Docs: See the Ignite Video API for creating and uploading videos: [Create video / upload docs](https://docs.ignite.video/api-reference/videos/create)

## Quick start

Requirements: Node 18+ (or latest LTS)

```bash
npm install
npm start
```

Open http://localhost:3000, paste your Bearer token, set API Base if needed, select up to 10 video files, choose visibility, and click Upload All.

## Build

```bash
npm run build
```

This outputs a static build in `build/` you can host on any static server (e.g. GitHub Pages, Netlify, S3 + CloudFront).

## Configuration

- API Token: Paste into the API Token field. Stored in `localStorage` under `ignite_token`.
- API Base: Defaults to `https://app.ignitevideo.cloud/api`. Stored in `localStorage` under `ignite_api_base`. Trailing slash is removed automatically.
- Visibility: Choose `private` or `public` prior to upload.

## Development notes

- This app intentionally avoids extra dependencies and uses Create React App for simplicity.
- Upload flow:
  1. Create video via `PUT /videos/upload` to receive signed URL
  2. Upload file directly to signed URL via `PUT`
  3. Poll `/videos/{VIDEO_ID}` every 10s until terminal state (e.g., COMPLETE)

## License

MIT © Contributors
