#!/usr/bin/env python3
"""Generate short '썰' videos using OpenAI + ElevenLabs (TTS) + Pexels (background) + ffmpeg,
then upload to YouTube and write metadata into web/data/.

Usage:
    python generate_and_upload.py --count 1 [--no-upload]
"""
import os
import sys
import argparse
import time
import json
import random
import subprocess
from pathlib import Path
from dotenv import load_dotenv
import requests
import openai

load_dotenv()

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
PEXELS_API_KEY = os.getenv('PEXELS_API_KEY')
YT_CLIENT_ID = os.getenv('YT_CLIENT_ID')
YT_CLIENT_SECRET = os.getenv('YT_CLIENT_SECRET')
YT_REFRESH_TOKEN = os.getenv('YT_REFRESH_TOKEN')

if not OPENAI_API_KEY:
    print('Missing OPENAI_API_KEY in environment or .env')
    sys.exit(1)
openai.api_key = OPENAI_API_KEY

BASE = Path(__file__).resolve().parent.parent
ASSETS = BASE / 'assets'
OUT = BASE / 'output'
WEB_DATA = BASE / 'web' / 'data'
ASSETS.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
WEB_DATA.mkdir(parents=True, exist_ok=True)

# Simple prompt for a 40-60s first-person '썰'
PROMPT_TEMPLATE = '''        유튜브 쇼츠용 썰을 만들어줘.
조건:
- 1인칭 시점
- 길이 약 40~60초 (한글 기준)
- 반전이 있는 이야기
- 문장 짧고 몰입감 있게
형식:
제목:
내용:
'''

def generate_story(topic=None):
    prompt = PROMPT_TEMPLATE
    if topic:
        prompt += '\n주제: ' + topic
    resp = openai.ChatCompletion.create(
        model='gpt-3.5-turbo',
        messages=[{'role':'user','content':prompt}],
        temperature=0.9,
        max_tokens=520
    )
    text = resp['choices'][0]['message']['content'].strip()
    # crude parse
    title = '썰'
    content = text
    if '제목:' in text and '내용:' in text:
        try:
            title = text.split('제목:')[1].split('내용:')[0].strip().splitlines()[0]
            content = text.split('내용:')[1].strip()
        except:
            pass
    return title, content

def tts_elevenlabs(text, out_path):
    assert ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY required for ElevenLabs TTS'
    url = 'https://api.elevenlabs.io/v1/text-to-speech/alloy'
    headers = {'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json'}
    payload = {'text': text, 'voice_settings': {'stability':0.5,'similarity_boost':0.75}}
    r = requests.post(url, headers=headers, json=payload, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f'ElevenLabs TTS error: {r.status_code} {r.text}')
    with open(out_path, 'wb') as f:
        for chunk in r.iter_content(10240):
            if chunk:
                f.write(chunk)
    return out_path

def download_pexels(query='office', per_page=3):
    if not PEXELS_API_KEY:
        return []
    headers = {'Authorization': PEXELS_API_KEY}
    url = 'https://api.pexels.com/videos/search'
    params = {'query': query, 'per_page': per_page}
    r = requests.get(url, headers=headers, params=params)
    if r.status_code != 200:
        print('Pexels error', r.status_code, r.text)
        return []
    data = r.json()
    saved = []
    for i, v in enumerate(data.get('videos', [])):
        files = v.get('video_files', [])
        if not files: continue
        files_sorted = sorted(files, key=lambda x: x.get('width',0), reverse=True)
        link = files_sorted[0].get('link')
        out = ASSETS / f'pexels_{query}_{i}.mp4'
        with requests.get(link, stream=True) as rr:
            if rr.status_code == 200:
                with open(out, 'wb') as f:
                    for chunk in rr.iter_content(10240):
                        if chunk:
                            f.write(chunk)
                saved.append(str(out))
    return saved

def choose_background(duration):
    # concatenate / trim assets until >= duration using ffmpeg.
    files = list(ASSETS.glob('*.mp4'))
    if not files:
        raise RuntimeError('No assets found. Place mp4 files under assets/ or set PEXELS_API_KEY to auto-download.')
    # For simplicity, pick random file and loop/trim
    src = random.choice(files)
    out = OUT / 'bg_concat.mp4'
    cmd = ['ffmpeg', '-y', '-stream_loop', '-1', '-i', str(src), '-t', str(duration+1), '-c', 'copy', str(out)]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out

def make_srt(content, audio_duration, out_path):
    # naive split into sentences
    import re
    sents = [s.strip() for s in re.split('(?<=[.?!\n])\s+', content) if s.strip()]
    if not sents:
        sents = [content]
    lengths = [len(s) for s in sents]
    total = sum(lengths)
    times = []
    start = 0.0
    for i, s in enumerate(sents, start=1):
        dur = max(1.0, audio_duration * (len(s)/total))
        end = start + dur
        times.append((i, start, end, s))
        start = end
    def fmt(t):
        h = int(t//3600); m=int((t%3600)//60); s=int(t%60); ms=int((t-int(t))*1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    with open(out_path, 'w', encoding='utf-8') as f:
        for idx, st, ed, txt in times:
            f.write(f"{idx}\n{fmt(st)} --> {fmt(ed)}\n{txt}\n\n")
    return out_path

def compose_video(audio_path, srt_path, duration, out_path):
    # pick a background and burn subtitles using ffmpeg subtitles filter
    bg = choose_background(duration)
    cmd = [
        'ffmpeg','-y','-i', str(bg), '-i', str(audio_path),
        '-c:v','libx264','-c:a','aac','-shortest',
        '-vf', f"subtitles={srt_path}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,Outline=2' ",
        str(out_path)
    ]
    subprocess.check_call(cmd)
    return out_path

def upload_to_youtube(video_file, title, description):
    # Upload using googleapiclient and a refresh token
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    # Build credentials from refresh token
    if not all([YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN]):
        print('Missing YouTube credentials; skipping upload.')
        return None
    creds = Credentials(
        None,
        refresh_token=YT_REFRESH_TOKEN,
        client_id=YT_CLIENT_ID,
        client_secret=YT_CLIENT_SECRET,
        token_uri='https://oauth2.googleapis.com/token'
    )
    youtube = build('youtube','v3', credentials=creds)
    body = {
        'snippet': {'title': title, 'description': description, 'categoryId': '22'},
        'status': {'privacyStatus': 'public'}
    }
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(str(video_file), chunksize=-1, resumable=True, mimetype='video/mp4')
    req = youtube.videos().insert(part=','.join(body.keys()), body=body, media_body=media)
    res = req.execute()
    return res.get('id')

def save_metadata(title, video_id, filename):
    meta = {'title': title, 'video_id': video_id, 'url': f'https://youtu.be/{video_id}', 'time': int(time.time())}
    out = WEB_DATA / filename
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return out

def run_once(topic=None, no_upload=False):
    title, content = generate_story(topic)
    # create tts
    audio_file = OUT / 'audio.mp3'
    print('TTS...')
    tts_elevenlabs(content, audio_file)
    # duration via ffprobe
    res = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', str(audio_file)], capture_output=True, text=True)
    duration = float(res.stdout.strip() or 10.0)
    srt = OUT / 'sub.srt'
    make_srt(content, duration, srt)
    video_out = OUT / 'shorts.mp4'
    print('Composing video...')
    compose_video(audio_file, srt, duration, video_out)
    video_id = None
    if not no_upload:
        print('Uploading to YouTube...')
        video_id = upload_to_youtube(video_out, title, content + '\n\nFree AI stock analysis: stockmind.kr')
    meta_file = f"meta_{int(time.time())}.json"
    save_metadata(title, video_id or '', meta_file)
    print('Done:', video_out)
    return video_out

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=1)
    parser.add_argument('--no-upload', action='store_true')
    args = parser.parse_args()
    for i in range(args.count):
        try:
            run_once(None, no_upload=args.no_upload)
        except Exception as e:
            print('Error:', e)
