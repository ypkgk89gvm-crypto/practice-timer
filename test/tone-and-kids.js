// Logic tests for the practice timer. No microphone: synthetic FFT frames and a jsdom page.
// Run: NODE_PATH=/tmp/jstest/node_modules node test/tone-and-kids.js
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var block = html.match(/<script>\s*\/\/ Practice sound detector:[\s\S]*?<\/script>/);
if (!block) throw new Error('detector script not found');
var saved = module.exports;
eval(block[0].replace(/<\/?script>/g, ''));
var api = module.exports;
module.exports = saved;
var analyzeTone = api.analyzeTone;
var createDetector = api.createDetector;

var failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok  ' + name); return; }
  failed++;
  console.error('  FAIL ' + name + (extra ? ' ' + JSON.stringify(extra) : ''));
}
function near(hz, target, tol) { return Math.abs(hz - target) <= (tol || 30); }

function dbToByte(db) {
  var b = Math.round((db + 100) / 70 * 255);
  if (b < 0) return 0;
  if (b > 255) return 255;
  return b;
}
function synth(opts) {
  var fftSize = opts.fftSize || 2048;
  var sampleRate = opts.sampleRate || 44100;
  var binHz = sampleRate / fftSize;
  var n = fftSize / 2;
  var bytes = new Uint8Array(n);
  var floorB = opts.floor == null ? 28 : opts.floor;
  for (var i = 0; i < n; i++) bytes[i] = floorB;
  (opts.peaks || []).forEach(function (pk) {
    var c = Math.round(pk.hz / binHz);
    var b = dbToByte(pk.db);
    var spread = pk.spread == null ? 2 : pk.spread;
    var step = pk.step == null ? 16 : pk.step;
    for (var k = -spread; k <= spread; k++) {
      var idx = c + k;
      if (idx > 0 && idx < n) {
        var bb = b - Math.abs(k) * step;
        if (bb > bytes[idx]) bytes[idx] = bb;
      }
    }
  });
  if (opts.wobble) {
    for (var j = 0; j < n; j++) {
      var d = Math.round(Math.sin(j * 12.9898) * opts.wobble);
      var v = bytes[j] + d;
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      bytes[j] = v;
    }
  }
  return bytes;
}
function series(f0, db0, nHarm, rolloff) {
  var peaks = [];
  for (var h = 1; h <= nHarm; h++) {
    var db = db0 - (h - 1) * rolloff;
    if (db < -95) break;
    peaks.push({ hz: f0 * h, db: db });
  }
  return peaks;
}
function tone(bytes, instrument) {
  return analyzeTone(bytes, { sampleRate: 44100, fftSize: 2048, minDb: -100, maxDb: -30, instrument: instrument || '' });
}

console.log('analyzeTone');
var sine = tone(synth({ peaks: [{ hz: 440, db: -36 }] }));
check('sine 440 is tonal', sine.tonal, sine);
check('sine f0 near 440', near(sine.f0, 440), sine);

var piano = tone(synth({ peaks: series(440, -38, 8, 6), floor: 32 }), 'Piano');
check('piano A4 is tonal', piano.tonal, piano);
check('piano f0 near 440', near(piano.f0, 440, 40), piano);

var violin = tone(synth({ peaks: series(660, -36, 10, 4), floor: 30 }), 'Violin');
check('violin E5 is tonal', violin.tonal, violin);

var highVln = tone(synth({ peaks: series(2500, -34, 4, 5), floor: 30 }), 'Violin');
check('high violin still tonal', highVln.tonal, highVln);
check('high violin f0 stable near the note or its half', near(highVln.f0, 2500, 80) || near(highVln.f0, 1250, 80), highVln);

var trumpetPeaks = [
  { hz: 233, db: -50 },
  { hz: 466, db: -36 },
  { hz: 699, db: -42 },
  { hz: 932, db: -48 },
  { hz: 1165, db: -54 }
];
var trumpet = tone(synth({ peaks: trumpetPeaks, floor: 30 }), 'Trumpet');
check('trumpet with weak fundamental is tonal', trumpet.tonal, trumpet);
check('trumpet f0 is the note or its octave', near(trumpet.f0, 233, 40) || near(trumpet.f0, 466, 40), trumpet);

var lowPiano = tone(synth({ peaks: series(110, -40, 12, 5), floor: 34 }), 'Piano');
check('low piano A2 is tonal', lowPiano.tonal, lowPiano);

var chord = tone(synth({
  peaks: series(262, -40, 6, 7).concat(series(330, -42, 6, 7)).concat(series(392, -41, 6, 7)),
  floor: 32
}), 'Piano');
check('piano chord is tonal', chord.tonal, chord);

// A clean vowel is harmonic, so it can still count. That limit is intentional.
var vowel = tone(synth({ peaks: series(140, -42, 12, 3), floor: 40, wobble: 3 }));
check('speech-like vowel can still look tonal', vowel.tonal, vowel);

var noise = tone(synth({ floor: 100, wobble: 6 }));
check('flat noise is not tonal', !noise.tonal, noise);

var tv = tone(synth({ floor: 90, wobble: 10 }));
check('TV-like broadband is not tonal', !tv.tonal, tv);

var thump = tone(synth({ peaks: [{ hz: 70, db: -28, spread: 28, step: 2 }], floor: 36 }));
check('broad thump is not tonal', !thump.tonal, thump);

var randomSpikes = synth({ floor: 40 });
[180, 540, 900, 1500, 2100, 2700, 3400].forEach(function (hz) {
  var c = Math.round(hz / (44100 / 2048));
  randomSpikes[c] = dbToByte(-48);
  if (c > 1) randomSpikes[c - 1] = dbToByte(-60);
  if (c + 1 < randomSpikes.length) randomSpikes[c + 1] = dbToByte(-60);
});
var spikes = tone(randomSpikes);
check('unrelated spikes are not tonal', !spikes.tonal, spikes);

['Piano', 'Violin', 'Trumpet', ''].forEach(function (inst) {
  check('noise rejected for ' + (inst || 'any instrument'), !tone(synth({ floor: 95, wobble: 8 }), inst).tonal);
  check('tone accepted for ' + (inst || 'any instrument'), tone(synth({ peaks: series(523, -38, 6, 6) }), inst).tonal);
});

var quiet = tone(synth({ floor: 4 }));
check('near-silence is not tonal', !quiet.tonal, quiet);
check('empty input is not tonal', !analyzeTone(null).tonal && !analyzeTone(new Uint8Array(0)).tonal);

console.log('detector');
function frames(det, n, levelFn, toneFn) {
  var r, saw = false, t = 0;
  for (var i = 0; i < n; i++) {
    t += 100;
    r = det.update(levelFn(i), t, false, toneFn ? toneFn(i) : undefined);
    if (r.playing) saw = true;
  }
  return { last: r, saw: saw };
}
var musical = { tonal: true, f0: 440, score: 0.9 };
var det = createDetector({ sensitivity: 5 });
det.calibrate(0.004);
var played = frames(det, 10, function (i) { return 0.03 + (i % 4) * 0.02; }, function () { return musical; });
check('stable tone above the floor counts as playing', played.last.playing, played.last);

var noisy = createDetector({ sensitivity: 10 });
noisy.calibrate(0.004);
var noiseRun = frames(noisy, 20, function (i) { return 0.08 + (i % 3) * 0.02; }, function () { return { tonal: false, f0: 0, score: 0.1 }; });
check('loud noise does not count, even at sensitive setting', !noiseRun.saw && !noiseRun.last.playing);

var quietTone = createDetector({ sensitivity: 10 });
quietTone.calibrate(0.02);
var tooQuiet = frames(quietTone, 12, function () { return 0.004; }, function () { return musical; });
check('a tone quieter than the room gate does not count', !tooQuiet.saw);

var jump = createDetector({ sensitivity: 5 });
jump.calibrate(0.004);
var jumpHz = [110, 165, 250, 370, 560, 840, 200, 300, 450, 680, 150, 225, 340, 510, 760];
var jumped = frames(jump, jumpHz.length, function () { return 0.06; }, function (i) { return { tonal: true, f0: jumpHz[i], score: 0.8 }; });
check('a pitch that jumps every frame does not count', !jumped.saw);

var oct = createDetector({ sensitivity: 5 });
oct.calibrate(0.004);
var octave = frames(oct, 10, function (i) { return 0.04 + (i % 3) * 0.015; }, function (i) { return { tonal: true, f0: i % 2 ? 880 : 440, score: 0.9 }; });
check('octave slips (fundamental vs 2nd harmonic) still count', octave.last.playing);

var volOnly = createDetector({ sensitivity: 5 });
volOnly.calibrate(0.004);
var legacy = frames(volOnly, 8, function (i) { return 0.03 + (i % 3) * 0.01; });
check('omitting the tone verdict keeps the volume gate (parent meter)', legacy.last.playing);

var gated = createDetector({ sensitivity: 5 });
gated.calibrate(0.004);
var gLast, gt = 0, gSaw = false;
for (var gi = 0; gi < 12; gi++) {
  gt += 100;
  gLast = gated.update(0.08, gt, true, musical);
  if (gLast.playing) gSaw = true;
}
check('metronome-gated frames do not count', !gSaw && gLast.loud === false);

var hum = createDetector({ sensitivity: 5, steadyMs: 4000, steadyCv: 0.05 });
hum.calibrate(0.004);
var humRun = frames(hum, 80, function () { return 0.05; }, function () { return { tonal: true, f0: 120, score: 0.95 }; });
check('a steady tonal hum is rejected after a few seconds', humRun.saw && !humRun.last.playing, humRun.last);

console.log('page');
var jsdom;
try { jsdom = require('jsdom'); } catch (e) { jsdom = null; }
if (!jsdom) {
  console.error('jsdom missing; skip page tests');
  failed++;
} else {
  var dom = new jsdom.JSDOM(html, {
    url: 'https://ypkgk89gvm-crypto.github.io/practice-timer/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: function (window) {
      window.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } }); };
    }
  });
  var window = dom.window;
  var document = window.document;
  var wpt = window.__wpt;
  check('page booted', !!wpt && !!wpt.KIDS);
  check('notes bypassed', wpt && wpt.NOTES_ON === false);
  check('loudness coaching off', wpt && wpt.LOUD_COACH_ON === false);
  check('html hides notes UI', document.documentElement.className.indexOf('notes-off') >= 0);

  var kids = wpt.KIDS;
  check('four choices', kids.length === 4);
  function has(name, instrument, minutes) {
    return kids.some(function (k) { return k.name === name && k.instrument === instrument && k.minutes === minutes; });
  }
  check('Abram piano 40', has('Abram', 'Piano', 40));
  check('Abram trumpet 20', has('Abram', 'Trumpet', 20));
  check('Eden piano 20', has('Eden', 'Piano', 20));
  check('Ellis violin 25', has('Ellis', 'Violin', 25));

  var buttons = document.querySelectorAll('#kids .kid');
  check('picker renders four buttons', buttons.length === 4);
  var labels = [];
  for (var bi = 0; bi < buttons.length; bi++) labels.push(buttons[bi].textContent.replace(/\s+/g, ' ').trim());
  check('picker shows trumpet 20', labels.some(function (t) { return t.indexOf('Abram') >= 0 && t.indexOf('Trumpet') >= 0 && t.indexOf('20') >= 0; }), labels);
  check('picker shows piano 40', labels.some(function (t) { return t.indexOf('Abram') >= 0 && t.indexOf('Piano') >= 0 && t.indexOf('40') >= 0; }), labels);
  check('picker shows Eden', labels.some(function (t) { return t.indexOf('Eden') >= 0 && t.indexOf('Piano') >= 0 && t.indexOf('20') >= 0; }));
  check('picker shows Ellis', labels.some(function (t) { return t.indexOf('Ellis') >= 0 && t.indexOf('Violin') >= 0 && t.indexOf('25') >= 0; }));

  check('no reset usual-loudness control', !document.getElementById('resetBase'));
  check('lesson button is in the hidden notes UI', document.getElementById('lessonBtn').className.indexOf('notes-ui') === -1 && document.getElementById('lessonBtn').parentNode.className.indexOf('notes-ui') >= 0);
  check('lesson and review screens are hidden notes UI', document.getElementById('lesson').className.indexOf('notes-ui') >= 0 && document.getElementById('review').className.indexOf('notes-ui') >= 0);

  var trumpetKid = kids.filter(function (k) { return k.instrument === 'Trumpet'; })[0];
  wpt.openKid(trumpetKid);
  check('ready screen names Abram trumpet', document.getElementById('readyWho').textContent.indexOf('Abram') >= 0 && document.getElementById('readyWho').textContent.indexOf('Trumpet') >= 0);
  check('trumpet target is 20:00', document.getElementById('readyClock').textContent === '20:00');
  check('ready screen has no teacher notes', document.getElementById('readyNotes').innerHTML === '');
  check('ready screen is showing', document.getElementById('ready').className.indexOf('on') >= 0);
  document.getElementById('lessonBtn').click();
  check('Lesson button does not open listening', document.getElementById('lesson').className.indexOf('on') < 0);

  var posts = [];
  window.fetch = function (url, opt) {
    posts.push({ url: url, method: opt && opt.method, type: opt && opt.headers && opt.headers['Content-Type'], body: opt && opt.body });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
  };
  function log(k, played, done) {
    wpt.logSession({ kid: k, startedAt: new Date(2026, 0, 15, 16, 5, 0), played: played }, done);
  }
  log(trumpetKid, 20 * 60, true);
  log(kids[0], 40 * 60, true);
  log(kids[2], 90, false);
  log(kids[3], 25 * 60, true);
  Promise.resolve().then(function () {
    check('logged four sessions', posts.length >= 1);
    var rows = [];
    posts.forEach(function (p) {
      var data = JSON.parse(p.body);
      check('log is a plain JSON post, not audio', p.method === 'POST' && String(p.type).indexOf('text/plain') >= 0 && !data.audio && !data.samples);
      (data.rows || []).forEach(function (r) { rows.push(r); });
    });
    function row(instrument) { return rows.filter(function (r) { return r.instrument === instrument; })[0]; }
    var tr = row('Trumpet'), ap = row('Piano'), ed = rows.filter(function (r) { return r.kid === 'Eden'; })[0], el = row('Violin');
    check('trumpet row is Abram 20', tr && tr.kid === 'Abram' && tr.target === 20 && tr.actual === 20 && tr.completed === 'Yes', tr);
    check('piano row is Abram 40', ap && ap.kid === 'Abram' && ap.instrument === 'Piano' && ap.target === 40 && ap.actual === 40, ap);
    check('Eden row unchanged', ed && ed.instrument === 'Piano' && ed.target === 20 && ed.actual === 1.5 && ed.completed === 'No', ed);
    check('Ellis row unchanged', el && el.kid === 'Ellis' && el.target === 25 && el.actual === 25, el);
    check('coaching summary does not say louder or softer', rows.every(function (r) { return !r.coaching || (String(r.coaching).indexOf('Louder') < 0 && String(r.coaching).indexOf('Softer') < 0); }));
    rows.forEach(function (r) {
      check('row has no audio payload', !r.audio && !r.spectrum && !r.samples && JSON.stringify(r).length < 500, r);
    });
    window.close();
    finish();
  }).catch(function (err) {
    console.error(err);
    failed++;
    try { window.close(); } catch (e) {}
    finish();
  });
}

function finish() {
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('all passed');
  process.exit(0);
}
if (!jsdom) finish();
