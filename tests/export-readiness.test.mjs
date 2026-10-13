import test from 'node:test';
import assert from 'node:assert/strict';
import { exportIssue } from '../shared/timing-validation.mjs';

const ready = () => ({ audioUrl: 'norae-audio://track/fixture', status: 'review', duration: 10, font: 'Arial', steps: { alignment: { state: 'done' } }, export: { state: 'idle' }, result: { lines: [{ text: 'Hold on', words: [{ text: 'Hold ', start: 1, end: 3 }, { text: 'on', start: 3, end: 4 }] }] } });
test('complete reviewer timing can be exported without an extra alignment request', () => {
  const track = ready(); assert.equal(exportIssue(track), null);
  track.steps.alignment.state = 'error'; assert.equal(exportIssue(track), null);
});
test('export readiness identifies the exact missing or invalid word boundary', () => {
  const track = ready(); track.result.lines[0].words[1].start = track.result.lines[0].words[1].end = null;
  assert.match(exportIssue(track), /Line 1, unit 2: set both/);
  track.result.lines[0].words[1] = { text: 'on', start: 2, end: 4 }; assert.match(exportIssue(track), /times must increase/);
  track.result.lines[0].words[1] = { text: 'away', start: 3, end: 4 }; assert.match(exportIssue(track), /reproduce/);
});
test('preparation and active exports block competing work, while cancelled exports can retry', () => {
  const track = ready(); track.status = 'processing'; assert.match(exportIssue(track), /Wait/);
  track.status = 'review'; track.steps.alignment.state = 'running'; assert.match(exportIssue(track), /Wait/);
  track.steps.alignment.state = 'done'; track.export.state = 'running'; assert.match(exportIssue(track), /already running/);
  track.export.state = 'cancelled'; assert.equal(exportIssue(track), null);
});
test('export rejects missing media, unsupported fonts and invalid recording durations', () => {
  assert.match(exportIssue(null), /audio/);
  const track = ready(); track.font = 'unknown'; assert.match(exportIssue(track), /Choose Arial/);
  track.font = 'Arial'; for (const duration of [0, NaN, Infinity]) { track.duration = duration; assert.match(exportIssue(track), /valid duration/); }
});
