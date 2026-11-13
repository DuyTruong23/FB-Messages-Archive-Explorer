#!/usr/bin/env node
// Generates fake Facebook and Messenger exports for device tests. No real data.
// Usage: node scripts/make-fake-archive.mjs <outputDir> [--big-video]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('Pass an output directory.');
const bigVideo = process.argv.includes('--big-video');
rmSync(out, { recursive: true, force: true });

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function media(dir, withBigVideo = false) {
  mkdirSync(dir, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', join(dir, 'photo.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-pix_fmt', 'yuv420p', join(dir, 'clip.mp4')]);
  if (withBigVideo) {
    // About 300 MB: 120 s at a constant 20 Mbit/s with noise so x264 cannot compress it away.
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '120', '-vf', 'noise=alls=40:allf=t',
      '-c:v', 'libx264', '-b:v', '20M', '-minrate', '20M', '-maxrate', '20M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', join(dir, 'big.mp4')]);
  }
}

// Facebook layout: your_facebook_activity/messages/inbox/<thread>/message_1.json
const inbox = join(out, 'facebook', 'your_facebook_activity', 'messages', 'inbox');
for (const [folder, other, count] of [['alice_100', 'Alice', 200], ['bob_200', 'Bob', 20]]) {
  const dir = join(inbox, folder);
  media(join(dir, 'photos'));
  const messages = Array.from({ length: count }, (_, index) => ({
    sender_name: index % 2 ? 'Tester' : other,
    timestamp_ms: 1767225600000 - index * 3600000,
    content: `fake message ${index} lỗi tiếng Việt`,
    ...(index === 3 ? { photos: [{ uri: `your_facebook_activity/messages/inbox/${folder}/photos/photo.png` }] } : {}),
    ...(index === 5 ? { videos: [{ uri: `your_facebook_activity/messages/inbox/${folder}/photos/clip.mp4` }] } : {}),
  }));
  writeFileSync(join(dir, 'message_1.json'), JSON.stringify({ participants: [{ name: other }, { name: 'Tester' }], messages, title: other }));
}

// Standalone Messenger layout: <thread>.json plus a media folder (overlay features apply here).
const messenger = join(out, 'messenger');
media(join(messenger, 'media'), bigVideo);
const thread = (name, count) => ({
  threadName: name,
  participants: [name, 'Tester'],
  messages: Array.from({ length: count }, (_, index) => ({
    senderName: index % 2 ? 'Tester' : name,
    text: `Messenger fake ${index} needle`,
    timestamp: 1767225600000 + index * 60000,
    ...(index === 2 ? { media: [{ uri: 'media/photo.png' }] } : {}),
    ...(index === 4 ? { media: [{ uri: 'media/clip.mp4' }] } : {}),
    ...(index === 6 && bigVideo ? { media: [{ uri: 'media/big.mp4' }] } : {}),
  })),
});
writeFileSync(join(messenger, 'Messenger Alice_0.json'), JSON.stringify(thread('Messenger Alice', 300)));
writeFileSync(join(messenger, 'Messenger Bob_0.json'), JSON.stringify(thread('Messenger Bob', 30)));
console.log(`Fake archives written to ${out}`);
