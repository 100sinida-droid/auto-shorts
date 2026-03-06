# auto-shorts
Automated YouTube Shorts pipeline (썰 채널)

This repository contains scripts and a GitHub Actions workflow to:
1. Generate short '썰' stories using OpenAI
2. Convert text to speech via ElevenLabs (or Edge TTS if preferred)
3. Download background video clips (Pexels) or use `assets/` folder
4. Compose video using ffmpeg and burn subtitles
5. Upload video to YouTube (via OAuth refresh token)
6. Commit metadata (JSON) back to the repo (so Cloudflare Pages can show list)

## How it works (high level)
- GitHub Actions runs on schedule (or manually) and executes `scripts/generate_and_upload.py`.
- The script creates a short video and uploads it to YouTube.
- The script writes a small JSON file under `web/data/` with metadata (title, url).
- Cloudflare Pages serves `web/` as a static site, showing the latest uploads.

## Files
- `.github/workflows/generate.yml` : GitHub Actions workflow (CRON or manual)
- `scripts/generate_and_upload.py` : Main orchestration script
- `web/index.html` : Simple static UI to show recent uploads (for Cloudflare Pages)
- `web/data/` : metadata files (committed by GH Actions)
- `assets/` : You can add your local mp4 files here to use as background

## Required secrets (set in GitHub repository settings)
- `OPENAI_API_KEY` : OpenAI API key
- `ELEVENLABS_API_KEY` : ElevenLabs API key (if using ElevenLabs TTS) *optional if using Edge TTS*
- `PEXELS_API_KEY` : (optional) for automatic background download
- `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` : YouTube OAuth credentials (see instructions below)
- `GITHUB_TOKEN` : automatically provided to Actions for commits (no extra setup)

## Quick local test (developer machine)
1. Install dependencies:
   ```
   python -m pip install -r scripts/requirements.txt
   ```
2. Create a `.env` file with your keys (or export env vars).
3. Place some mp4 clips in `assets/` or set `PEXELS_API_KEY`.
4. Run:
   ```
   python scripts/generate_and_upload.py --count 1 --no-upload
   ```
5. Check `output/` for generated files and `web/data/` for metadata JSON.

## Notes & Caveats
- This repo provides a practical starting point. Automating YouTube uploads requires a valid refresh token.
- Generating many videos quickly may hit API usage limits; use responsibly.
- For Cloudflare Pages: connect this GitHub repo to Cloudflare Pages and deploy `web/` as the site root.

If you want, I can:
- create a GitHub repo for you (I can't push it myself) — I'll provide the full files to upload
- walk you through creating YouTube OAuth refresh token
- customize prompts, voices, or the page design
