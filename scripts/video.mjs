import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
export function studyVideo(file, { out, frames = 8 } = {}) {
  if (!existsSync(file)) throw new Error('Video does not exist: ' + file);
  if (!Number.isInteger(frames) || frames < 2 || frames > 24) throw new Error('Frames must be between 2 and 24.');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', resolve(file)], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  if (probe.status !== 0) throw new Error('ffprobe failed; install FFmpeg and check the input video.');
  const duration = Number(JSON.parse(probe.stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration is unavailable.');
  const dir = resolve(out || 'video-review'); mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < frames; i++) {
    const time = duration * (i + 0.5) / frames;
    const target = join(dir, 'frame-' + String(i + 1).padStart(2, '0') + '.jpg');
    const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', resolve(file), '-frames:v', '1', '-vf', 'scale=960:-2', '-y', target], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 });
    if (run.status !== 0) throw new Error('FFmpeg could not extract frame ' + (i + 1));
    files.push({ file: target, seconds: time });
  }
  writeFileSync(join(dir, 'frames.json'), JSON.stringify({ duration, frames: files }, null, 2) + '\n');
  return files;
}
