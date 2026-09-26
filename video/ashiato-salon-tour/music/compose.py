# あしあとさろん サイトツアー用 BGM — gentle acoustic, F major, 120 BPM, 30s.
# Scene cuts: 3.5s (beat 7), 9.5 (19), 14.5 (29), 20.5 (41), 25.5 (51); end 30s (beat 60).
import random
import mido

TPB = 480  # ticks per beat
BPM = 120
random.seed(7)

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'Bb': 10, 'B': 11}


def n(name):  # "A4" -> midi
    pc, octv = name[:-1], int(name[-1])
    return 12 * (octv + 1) + NOTE[pc]


events = []  # (tick, type, channel, note/program, velocity)


def note(ch, beat, pitch, dur, vel, jitter=True):
    t = int(beat * TPB) + (random.randint(-8, 8) if jitter else 0)
    t = max(0, t)
    v = max(1, min(127, vel + (random.randint(-5, 5) if jitter else 0)))
    events.append((t, 'on', ch, pitch, v))
    events.append((t + int(dur * TPB) - 10, 'off', ch, pitch, 0))


# channels
GTR, PNO, BASS, PAD, GLK, DRM = 0, 1, 2, 3, 4, 9
PROGRAMS = {GTR: 24, PNO: 0, BASS: 32, PAD: 89, GLK: 9}  # nylon gtr, piano, ac. bass, warm pad, glockenspiel

CHORDS = {  # root, guitar voicing (low->high)
    'F': ('F2', ['F2', 'C3', 'F3', 'A3', 'C4', 'F4']),
    'C': ('C3', ['C3', 'G3', 'C4', 'E4', 'G4', 'C5']),
    'Dm': ('D3', ['D3', 'A3', 'D4', 'F4', 'A4', 'D5']),
    'Bb': ('Bb2', ['Bb2', 'F3', 'Bb3', 'D4', 'F4', 'Bb4']),
}
PAD_VOICE = {
    'F': ['F3', 'A3', 'C4'], 'C': ['E3', 'G3', 'C4'],
    'Dm': ['F3', 'A3', 'D4'], 'Bb': ['F3', 'Bb3', 'D4'],
}
ARP = [0, 2, 3, 4, 5, 4, 3, 2]  # indexes into the 6-note voicing, 8 eighths per bar


def guitar_bar(beat0, chord, vel=62, beats=4):
    voicing = [n(x) for x in CHORDS[chord][1]]
    for i in range(int(beats * 2)):
        idx = ARP[i % 8]
        note(GTR, beat0 + i * 0.5, voicing[idx], 1.0, vel - (6 if i % 2 else 0))


def pad(beat0, chord, beats, vel=34):
    for p in PAD_VOICE[chord]:
        note(PAD, beat0, n(p), beats, vel, jitter=False)


def bass_bar(beat0, chord, vel=66):
    root = n(CHORDS[chord][0])
    note(BASS, beat0, root, 1.8, vel)
    note(BASS, beat0 + 2, root + 7 if chord != 'Bb' else root + 7, 1.8, vel - 8)


# ---------- intro: 0–3.5s (beats 0–7) ----------
guitar_bar(0, 'F', vel=54, beats=7)
pad(0, 'F', 7, vel=28)
note(GLK, 2.0, n('C6'), 1.5, 44)   # logo / name reveal sparkle
note(GLK, 3.0, n('F6'), 2.0, 40)
note(GLK, 5.0, n('A5'), 1.5, 34)   # "公式サイトをのぞいてみよう" pill

# ---------- main: 3.5–25.5s (beats 7–51), 11 bars ----------
PROG = ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C', 'Dm', 'Bb', 'C']
MELODY = [
    [(0, 'A4', 1), (1, 'C5', 1), (2, 'F5', 1.5), (3.5, 'E5', 0.5)],
    [(0, 'D5', 1), (1, 'C5', 1), (2, 'G4', 2)],
    [(0, 'A4', 1), (1, 'C5', 1), (2, 'D5', 1), (3, 'F5', 1)],
    [(0, 'F5', 1.5), (1.5, 'D5', 0.5), (2, 'C5', 2)],
    [(0, 'A4', 1), (1, 'C5', 1), (2, 'F5', 1), (3, 'G5', 1)],
    [(0, 'A5', 1.5), (1.5, 'G5', 0.5), (2, 'E5', 2)],
    [(0, 'F5', 1), (1, 'D5', 1), (2, 'C5', 1), (3, 'D5', 1)],
    [(0, 'E5', 1), (1, 'G5', 1), (2, 'C5', 2)],
    [(0, 'D5', 1), (1, 'F5', 1), (2, 'A5', 1.5), (3.5, 'G5', 0.5)],
    [(0, 'F5', 1), (1, 'D5', 1), (2, 'C5', 1), (3, 'A4', 1)],
    [(0, 'G4', 1), (1, 'C5', 1), (2, 'E5', 1), (3, 'G5', 1)],
]
for i, chord in enumerate(PROG):
    b0 = 7 + i * 4
    guitar_bar(b0, chord, vel=60 if i < 3 else 64)
    bass_bar(b0, chord)
    pad(b0, chord, 4, vel=30)
    for (off, p, d) in MELODY[i]:
        note(PNO, b0 + off, n(p), d, 72 if i < 8 else 76)
    # shaker from the gallery scene (beat 19) on
    if b0 >= 19:
        for k in range(8):
            note(DRM, b0 + k * 0.5, 82, 0.25, 40 if k % 2 == 0 else 26)

# scene-change chimes: 14.5s (beat 29) and 20.5s (beat 41)
note(GLK, 29, n('C6'), 1.5, 46)
note(GLK, 29.5, n('F6'), 1.5, 36)
note(GLK, 41, n('E6'), 1.5, 46)
note(GLK, 41.5, n('G6'), 1.5, 36)

# ---------- ending: 25.5–30s (beats 51–60) ----------
END = 51
note(BASS, END, n('F2'), 9, 70, jitter=False)
for k, p in enumerate(CHORDS['F'][1]):  # soft strum
    note(GTR, END + k * 0.06, n(p), 9, 60, jitter=False)
note(PNO, END, n('F5'), 9, 74, jitter=False)
note(PNO, END, n('A4'), 9, 56, jitter=False)
note(PNO, END, n('C5'), 9, 56, jitter=False)
pad(END, 'F', 9, vel=32)
note(GLK, END + 1, n('C6'), 2, 38)
note(GLK, END + 2, n('F6'), 3, 34)

# ---------- write ----------
mid = mido.MidiFile(ticks_per_beat=TPB)
track = mido.MidiTrack()
mid.tracks.append(track)
track.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM), time=0))
for ch, prog in PROGRAMS.items():
    track.append(mido.Message('program_change', channel=ch, program=prog, time=0))
# channel volumes / reverb send
for ch, vol in {GTR: 96, PNO: 100, BASS: 88, PAD: 70, GLK: 80, DRM: 60}.items():
    track.append(mido.Message('control_change', channel=ch, control=7, value=vol, time=0))
    track.append(mido.Message('control_change', channel=ch, control=91, value=60, time=0))
track.append(mido.Message('control_change', channel=GTR, control=10, value=50, time=0))  # pan slightly left
track.append(mido.Message('control_change', channel=PNO, control=10, value=74, time=0))  # slightly right

events.sort(key=lambda e: (e[0], 0 if e[1] == 'off' else 1))
now = 0
for t, typ, ch, p, v in events:
    msg = 'note_on' if typ == 'on' else 'note_off'
    track.append(mido.Message(msg, channel=ch, note=p, velocity=v, time=t - now))
    now = t
mid.save('bgm.mid')
print('events', len(events), 'length', round(mid.length, 2), 's')
