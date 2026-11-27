#!/usr/bin/env python3
"""Tri-Cam plan check: validates a QGroundControl .plan file against the Tri-Cam plan rules.

    python3 tricam_plan_check.py validate my.plan            # findings as text
    python3 tricam_plan_check.py validate my.plan --json     # findings as JSON
    python3 tricam_plan_check.py stamp in.plan out.plan [UUID]
                                  # a new mission UUID (random, or 32 hex digits) in a plan's Tri-Cam header,
                                  # the same settings, the rest of the file kept; then validated

Exit status: 0 no errors (warnings allowed), 1 errors, 2 the file cannot be read as a plan (or a usage error).
The rules are those the Tri-Cam Plan Loader checks on the flight controller before it allows arming; they are
described in PLAN_DEVELOPMENT_GUIDE.md. Python 3.8 or later, standard library only.
"""
from __future__ import annotations

import json
import os
import struct
import sys
from dataclasses import dataclass, field, replace
from typing import List, Optional, Tuple

# BEGIN GENERATED (build_kit.py from the Tri-Cam plan rules; do not edit by hand)
PLAN_LOADER_BUILD = 5
RULES_VERSION = 1
PROTOCOL_VERSION = 1
MAGIC = 0x54
CMD_DELAY, CMD_SCRIPT, CMD_CFG, CMD_FOCUS = 112, 217, 531, 532
CMD_START, CMD_PAUSE, CMD_SINGLE = 2500, 2501, 2000
NAV_COMMANDS = frozenset([16, 17, 18, 19, 20, 21, 22, 82, 92, 93, 94])
MIN_PACING_S = 0.1
MIN_PHOTO_SPACING_S = 0.25
AEC_CAL_MIN_FRAMES = 4
AEC_CAL_DEFAULT_FRAMES = 8
EXPOSURE_LINE_US = 27.6345238
EXPOSURE_MAX_LINES = 362
CHECK1 = (4, 3, 15, 20)   # Series word: check width, polynomial, initial value, data bits
CHECK2 = (6, 3, 63, 18)   # Sensor word
S_HEADER, S_UUID_A, S_UUID_B, S_SERIES, S_SENSOR, S_CHECK = 1, 2, 3, 4, 5, 6
MAX_SENSORS = 3
DEFAULT_SERIES = {'interval_n': 36, 'max_scale': 15, 'adaptive': 0, 'exposure_mode': 1, 'compression': 0, 'aec_cal_frames': 0}   # the settings in force without a Series word
ANNOTATION_KEY = '_tricam'
ANNOTATION_UUID = 'Mission UUID'   # the annotation's key for the mission UUID
FORMS = {
    'header': 'Tri-Cam: PLAN INVALID ({code})',
    'plan': 'Tri-Cam: PLAN ERROR ({code})',
    'item': 'Tri-Cam: PLAN ERROR ({code}) item {item}',
    'warning': 'Tri-Cam: Plan warning ({code}) item {item}',
}
RULES = {
    'H-ORDER': {'code': 'ORDER', 'scope': 'header', 'severity': 'error', 'reason': 'ORDER', 'text': 'header stanzas out of order, a position gap or a repeated optional stanza'},
    'H-COUNT': {'code': 'COUNT', 'scope': 'header', 'severity': 'error', 'reason': 'COUNT', 'text': "the header's stanza count does not match, or the Check stanza is not last"},
    'H-CHECK': {'code': 'CHECK', 'scope': 'header', 'severity': 'error', 'reason': 'CHECK', 'text': 'the header fingerprint does not match (something was edited or reordered)'},
    'H-UUID': {'code': 'UUID', 'scope': 'header', 'severity': 'error', 'reason': 'UUID', 'text': 'the mission UUID is missing, all 0x00 or all 0xFF'},
    'H-VERSION': {'code': 'VERSION', 'scope': 'header', 'severity': 'error', 'reason': 'VERSION', 'text': 'the header version is not one the Plan Loader reads'},
    'H-WORD': {'code': 'WORD', 'scope': 'header', 'severity': 'error', 'reason': 'WORD', 'text': "an embedded Series or Sensor word failed its check or range, or the header's Series word selects exposure mode 3"},
    'H-RESERVED': {'code': 'RESERVED', 'scope': 'header', 'severity': 'error', 'reason': 'RESERVED', 'text': 'a reserved word or flag is not 0'},
    'H-STANZA': {'code': 'STANZA', 'scope': 'header', 'severity': 'error', 'reason': 'STANZA', 'text': 'unknown stanza type'},
    'H-DUPLICATE': {'code': 'DUPLICATE', 'scope': 'header', 'severity': 'error', 'reason': 'DUPLICATE', 'text': 'more than one Header stanza'},
    'H-PLACEMENT': {'code': 'PLACEMENT', 'scope': 'header', 'severity': 'error', 'reason': 'PLACEMENT', 'text': 'header items are not consecutive, or not before the first navigation item'},
    'P-NO-HEADER': {'code': 'NO_HEADER', 'scope': 'plan', 'severity': 'error', 'names_item': True, 'text': 'survey commands present but no Tri-Cam header (they would be ignored); the message names the first survey command'},
    'P-NO-END': {'code': 'NO_END', 'scope': 'plan', 'severity': 'error', 'text': 'a survey Start but no End (#532, p1 = 4) before the final navigation item: ArduPilot reports the mission complete only when its last item finishes (at the landing for an RTL or LAND ending), too late to have the cards synced before landing'},
    'P-SINGLE-FORM': {'code': 'SINGLE', 'scope': 'item', 'severity': 'error', 'text': '#2000 in a plan must be exactly a single shot (p1 = 0, p2 = 0, p3 = 1); a series would be run by the flight controller as repeated single shots. Use the header and Start for surveys'},
    'P-FORBIDDEN-2001': {'code': 'STOP', 'scope': 'item', 'severity': 'error', 'command': 2001, 'text': '#2001 (stop capture) in a plan: it only stops a flight-controller photo series, which a plan must not start'},
    'P-FORBIDDEN-203': {'code': 'DIGICAM', 'scope': 'item', 'severity': 'error', 'command': 203, 'text': "#203 (digicam control) in a plan: the flight controller turns it into a photo trigger outside the Tri-Cam's rules"},
    'P-FORBIDDEN-206': {'code': 'TRIG_DIST', 'scope': 'item', 'severity': 'error', 'command': 206, 'text': "#206 (camera trigger distance) in a plan: the flight controller would fire photos by distance, ignoring the Tri-Cam's state"},
    'P-AFTER-NAV': {'code': 'AFTER_NAV', 'scope': 'item', 'severity': 'error', 'text': 'Tri-Cam command after the final navigation item: only the first item after it runs, later ones never do'},
    'P-PACING': {'code': 'PACING', 'scope': 'item', 'severity': 'error', 'text': 'fewer than {need}s of #112 delay since previous {what} (item {previous})'},
    'P-START-P1': {'code': 'P1', 'scope': 'item', 'severity': 'error', 'text': '{name} in a plan must have p1 = 0 (stream id 0; p2 to p7 are ignored)'},
    'P-BAD-WORD': {'code': 'BAD_WORD', 'scope': 'item', 'severity': 'error', 'text': 'bad word: {error}'},
    'P-CAL-BUSY': {'code': 'CAL_BUSY', 'scope': 'item', 'severity': 'error', 'text': '{what} while AEC_Cal is running would be ignored: send a Pause first (item {cal_start})'},
    'P-CAL-SINGLE': {'code': 'CAL_BUSY', 'scope': 'item', 'severity': 'error', 'text': 'single shot while AEC_Cal is running would be ignored'},
    'P-REFUSED': {'code': 'REFUSED', 'scope': 'item', 'severity': 'error', 'text': '{event} would be refused in state {state}'},
    'P-START-NOOP': {'code': 'NOOP', 'scope': 'item', 'severity': 'error', 'text': 'Start while the survey is already running does nothing'},
    'P-SENSOR-MODE': {'code': 'SENSOR', 'scope': 'item', 'severity': 'error', 'text': 'Sensor word ({where}, {kind}, {cameras}) does not match exposure mode {mode} at this Start, so the Tri-Cam would ignore it'},
    'P-CAL-SHORT': {'code': 'CAL_SHORT', 'scope': 'item', 'severity': 'warning', 'text': 'Pause cuts AEC_Cal short ({budget}s of delay, about {frames} frames, {need}s for a full run); {verdict}'},
    'F-ANNOTATION-UUID': {'code': 'ANNOT_UUID', 'scope': 'file', 'severity': 'warning', 'text': "the annotation's Mission UUID {annotation} differs from the header's mission UUID {header}"},
    'F-ANNOTATION-VERSION': {'code': 'ANNOT_VER', 'scope': 'file', 'severity': 'warning', 'text': 'annotation interfaceVersion differs from the header version'},
}
TABLE = {   # state -> event -> rules in order: (condition, next state, accepted, effects)
    'IDLE': {
        'CFG': [(None, 'IDLE', True, ('APPLY_CONFIG',))],
        'START': [('mode3', 'AEC_CAL', True, ('BEGIN_AEC_CAL',)), ('not_mode3', 'ACTIVE', True, ('BEGIN_SURVEY',))],
        'PAUSE': [(None, 'IDLE', True, ())],
        'SINGLE': [(None, 'IDLE', True, ('TAKE_PHOTO',))],
        'END': [(None, 'ENDED', True, ('END_SURVEY',))],
    },
    'AEC_CAL': {
        'CFG': [(None, 'AEC_CAL', False, ())],
        'START': [(None, 'AEC_CAL', False, ())],
        'PAUSE': [(None, 'IDLE', True, ('EXIT_AEC_CAL',))],
        'SINGLE': [(None, 'AEC_CAL', False, ())],
        'END': [(None, 'ENDED', True, ('EXIT_AEC_CAL', 'END_SURVEY'))],
    },
    'ACTIVE': {
        'CFG': [(None, 'ACTIVE', False, ())],
        'START': [(None, 'ACTIVE', True, ())],
        'PAUSE': [(None, 'IDLE', True, ())],
        'SINGLE': [(None, 'ACTIVE', False, ())],
        'END': [(None, 'ENDED', True, ('END_SURVEY',))],
    },
    'ENDED': {
        'CFG': [(None, 'ENDED', False, ())],
        'START': [(None, 'ENDED', False, ())],
        'PAUSE': [(None, 'ENDED', True, ())],
        'SINGLE': [(None, 'ENDED', False, ())],
        'END': [(None, 'ENDED', True, ())],
    },
}
# END GENERATED

LEVEL = {"error": "ERROR", "warning": "WARNING"}
FORBIDDEN = {r["command"]: rid for rid, r in RULES.items() if "command" in r}
IDLE, AEC_CAL, ACTIVE = "IDLE", "AEC_CAL", "ACTIVE"


class WordError(ValueError):
    pass


class PlanFileError(Exception):
    """The file is not a readable .plan (exit status 2)."""


# ----------------------------------------------------------------- check bits and fingerprint
def crc_bits(data: int, nbits: int, width: int, poly: int, init: int) -> int:
    """Bitwise CRC, most significant bit first, over the low `nbits` bits of `data`."""
    reg, mask = init, (1 << width) - 1
    for i in range(nbits - 1, -1, -1):
        top = (reg >> (width - 1)) & 1
        reg = (reg << 1) & mask
        if top ^ ((data >> i) & 1):
            reg ^= poly
    return reg


def crc16_ccitt(data: bytes) -> int:
    """CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection, no final XOR."""
    reg = 0xFFFF
    for b in data:
        reg ^= b << 8
        for _ in range(8):
            reg = ((reg << 1) ^ 0x1021) & 0xFFFF if reg & 0x8000 else (reg << 1) & 0xFFFF
    return reg


def _check1(data20: int) -> int:
    w, poly, init, nbits = CHECK1
    return crc_bits(data20, nbits, w, poly, init)


def _check2(data18: int) -> int:
    w, poly, init, nbits = CHECK2
    return crc_bits(data18, nbits, w, poly, init)


# ----------------------------------------------------------------- words
@dataclass
class SeriesConfig:
    """The Series Capture Config word (#531 p1 = 1, and the header's Series stanza). Fields are raw codes."""
    interval_n: int = 0        # 0..250 -> 0.500 + 0.014*n seconds
    max_scale: int = 15        # 0..15  -> adaptive maximum period = base * (1 + m/15)
    adaptive: int = 0          # 0 fixed cadence, 1 adaptive cadence
    exposure_mode: int = 0     # 0 no change, 1 fixed, 2 AEC, 3 AEC_Cal
    compression: int = 0       # 0 uncompressed, 1 DPCM
    aec_cal_frames: int = 0    # 0..15 (0 = the Tri-Cam's default)

    @property
    def interval_s(self) -> float:
        return 0.5 + 0.014 * self.interval_n

    def validate(self):
        if not 0 <= self.interval_n <= 250: raise WordError("interval code 0..250")
        if not 0 <= self.max_scale <= 15: raise WordError("max_scale 0..15")
        if self.adaptive not in (0, 1): raise WordError("adaptive 0/1")
        if self.exposure_mode not in (0, 1, 2, 3): raise WordError("exposure_mode 0..3")
        if self.compression not in (0, 1): raise WordError("compression 0/1")
        if not 0 <= self.aec_cal_frames <= 15: raise WordError("aec_cal_frames 0..15")
        if self.exposure_mode == 3 and 0 < self.aec_cal_frames < AEC_CAL_MIN_FRAMES:
            raise WordError(f"AEC_Cal frames must be 0 (default) or at least {AEC_CAL_MIN_FRAMES}")

    def encode(self) -> int:
        self.validate()
        d = (self.interval_n | self.max_scale << 8 | self.adaptive << 12 |
             self.exposure_mode << 13 | self.compression << 15 | self.aec_cal_frames << 16)
        return d | _check1(d) << 20

    @staticmethod
    def decode(word: int) -> "SeriesConfig":
        if not 0 <= word <= 0xFFFFFF or word != int(word): raise WordError("not a 24-bit integer")
        if _check1(word & 0xFFFFF) != word >> 20: raise WordError("check bits mismatch")
        c = SeriesConfig(word & 0xFF, word >> 8 & 0xF, word >> 12 & 1, word >> 13 & 3, word >> 15 & 1, word >> 16 & 0xF)
        c.validate()
        return c


@dataclass
class SensorConfig:
    """The Sensor Config word (#531 p1 = 2, and the header's Sensor stanzas). Fields are raw codes."""
    exposure_lines: int = 0    # 0 no change, 1..EXPOSURE_MAX_LINES sensor lines
    iso_step: int = 0          # 0 no change, 2..44 -> ISO = 50*step (100..2200)
    bounds: int = 0            # 0 fixed values, 1 AEC bounds (longest exposure, highest ISO)
    channel: int = 3           # 0..2 one camera, 3 all

    def validate(self):
        if not 0 <= self.exposure_lines <= EXPOSURE_MAX_LINES: raise WordError(f"exposure_lines 0..{EXPOSURE_MAX_LINES}")
        if self.iso_step != 0 and not 2 <= self.iso_step <= 44: raise WordError("iso_step 0 or 2..44")
        if self.bounds not in (0, 1): raise WordError("bounds 0/1")
        if not 0 <= self.channel <= 3: raise WordError("channel 0..3")

    def encode(self) -> int:
        self.validate()
        d = self.exposure_lines | self.iso_step << 9 | self.bounds << 15 | self.channel << 16
        return d | _check2(d) << 18

    @staticmethod
    def decode(word: int) -> "SensorConfig":
        if not 0 <= word <= 0xFFFFFF or word != int(word): raise WordError("not a 24-bit integer")
        if _check2(word & 0x3FFFF) != word >> 18: raise WordError("check bits mismatch")
        c = SensorConfig(word & 0x1FF, word >> 9 & 0x3F, word >> 15 & 1, word >> 16 & 3)
        c.validate()
        return c


DEFAULT = SeriesConfig(**DEFAULT_SERIES)


def item(command: int, params: List[float]) -> dict:
    return {"command": command, "params": list(params) + [0.0] * (7 - len(params))}


def is_inflight(it: dict) -> bool:
    """A Tri-Cam command that acts in flight: Config (#531 p1 = 1 or 2), Start, Pause, End (#532 p1 = 4), single shot."""
    c, p = it["command"], it["params"]
    return c in (CMD_START, CMD_PAUSE, CMD_SINGLE) or (c == CMD_CFG and p[0] in (1, 2)) or (c == CMD_FOCUS and p[0] == 4)


# ----------------------------------------------------------------- header (#217 stanzas)
def _stanza_item(typ: int, pos: int, w: Tuple[int, int, int]) -> dict:
    return item(CMD_SCRIPT, [typ << 8 | pos, float(w[0]), float(w[1]), float(w[2])])


def _words_of(data: bytes) -> Tuple[int, int, int]:
    data = data.ljust(9, b"\0")
    return tuple(int.from_bytes(data[i:i + 3], "big") for i in (0, 3, 6))  # type: ignore


def _bytes_of(w) -> bytes:
    return b"".join(x.to_bytes(3, "big") for x in w)


def fingerprint_of(stanzas: List[Tuple[int, Tuple[int, int, int]]]) -> int:
    """CRC-16/CCITT-FALSE over, for each stanza before Check: p1 (2 bytes) then W0, W1, W2 (3 bytes each)."""
    raw = b"".join(struct.pack(">H", typ << 8 | pos) + _bytes_of(w) for pos, (typ, w) in enumerate(stanzas))
    return crc16_ccitt(raw)


def build_header(uuid: bytes, series: Optional[SeriesConfig] = None, sensors: Optional[List[SensorConfig]] = None) -> List[dict]:
    if len(uuid) != 16 or uuid in (bytes(16), b"\xff" * 16): raise WordError("UUID must be 16 bytes, not all 0x00/0xFF")
    if len(sensors or []) > MAX_SENSORS: raise WordError("at most 3 Sensor stanzas")
    specs = [(S_UUID_A, _words_of(uuid[:9])), (S_UUID_B, _words_of(uuid[9:]))]
    if series: specs.append((S_SERIES, (series.encode(), 0, 0)))
    for sn in sensors or []: specs.append((S_SENSOR, (sn.encode(), 0, 0)))
    chain = [(S_HEADER, (MAGIC << 16 | PROTOCOL_VERSION << 8, 0, len(specs) + 1))] + specs
    chain.append((S_CHECK, (fingerprint_of(chain), 0, 0)))
    return [_stanza_item(typ, pos, w) for pos, (typ, w) in enumerate(chain)]


@dataclass
class Header:
    status: str                     # NO_HEADER | OK | INVALID
    reason: str = ""
    uuid: bytes = b""
    series: Optional[SeriesConfig] = None
    sensors: List[SensorConfig] = field(default_factory=list)
    fingerprint: int = 0
    item_count: int = 0             # number of #217 items in the header (Header .. Check)


def _words(it: dict) -> Optional[Tuple[int, int, int, int]]:
    p = it["params"]
    if any(x != x or x < 0 or x > 0xFFFFFF or x != int(x) for x in p[1:4]) or not 0 <= p[0] <= 0xFFFF or p[0] != int(p[0]):
        return None
    return int(p[0]), int(p[1]), int(p[2]), int(p[3])


_ORDER = {S_UUID_A: 0, S_UUID_B: 1, S_SERIES: 2, S_SENSOR: 3, S_CHECK: 4}


def parse_header(items: List[dict]) -> Header:
    recs, rec_idx = [], []
    for i, it in enumerate(items):
        w = _words(it) if it["command"] == CMD_SCRIPT else None
        if w:
            recs.append(w)
            rec_idx.append(i)
    heads = [i for i, r in enumerate(recs) if r[0] >> 8 == S_HEADER and r[1] >> 16 == MAGIC]
    if not heads: return Header("NO_HEADER")
    bad = lambda why: Header("INVALID", why)  # noqa: E731
    if len(heads) != 1: return bad("DUPLICATE")
    h = recs[heads[0]]
    if h[0] & 0xFF != 0: return bad("ORDER")
    if (h[1] >> 8) & 0xFF != PROTOCOL_VERSION: return bad("VERSION")
    if h[1] & 0xFF != 0 or h[2] != 0: return bad("RESERVED")
    n = h[3]
    body = recs[heads[0] + 1:heads[0] + 1 + n]
    if n < 3 or len(body) != n: return bad("COUNT")
    if [r[0] & 0xFF for r in body] != list(range(1, n + 1)): return bad("ORDER")
    types = [r[0] >> 8 for r in body]
    if types[-1] != S_CHECK: return bad("COUNT")
    if any(t not in _ORDER for t in types): return bad("STANZA")
    ranks = [_ORDER[t] for t in types]
    if ranks != sorted(ranks) or types[:2] != [S_UUID_A, S_UUID_B]: return bad("ORDER")
    if types.count(S_SERIES) > 1 or types.count(S_SENSOR) > MAX_SENSORS or types.count(S_CHECK) != 1:
        return bad("ORDER")
    out = Header("OK")
    out.item_count = n + 1
    chain = [(S_HEADER, tuple(h[1:4]))]
    for r in body[:-1]:
        chain.append((r[0] >> 8, (r[1], r[2], r[3])))
    for typ, w in chain[1:]:
        try:
            if typ == S_UUID_A: ua = _bytes_of(w)
            elif typ == S_UUID_B:
                ub = _bytes_of(w)
                if ub[7:] != b"\0\0": return bad("RESERVED")
            elif typ in (S_SERIES, S_SENSOR):
                if w[1] or w[2]: return bad("RESERVED")
                if typ == S_SERIES:
                    out.series = SeriesConfig.decode(w[0])
                    if out.series.exposure_mode == 3: return bad("WORD")   # AEC_Cal is started in flight, not set up here
                else: out.sensors.append(SensorConfig.decode(w[0]))
        except WordError:
            return bad("WORD")
    out.uuid = ua + ub[:7]
    if out.uuid in (bytes(16), b"\xff" * 16): return bad("UUID")
    chk = body[-1]
    if chk[2] or chk[3] or chk[1] > 0xFFFF: return bad("RESERVED" if chk[1] <= 0xFFFF else "CHECK")
    out.fingerprint = fingerprint_of(chain)
    if out.fingerprint != chk[1]: return bad("CHECK")
    idx = rec_idx[heads[0]:heads[0] + n + 1]
    if idx != list(range(idx[0], idx[0] + n + 1)): return bad("PLACEMENT")
    first_nav = next((i for i, it in enumerate(items) if it["command"] in NAV_COMMANDS), None)
    if first_nav is not None and first_nav < idx[-1]: return bad("PLACEMENT")
    return out


def uuid_text(uuid: bytes) -> str:
    h = uuid.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def plan_loaded_message(uuid: bytes) -> str:
    """What the Plan Loader posts when the Tri-Cam holds this plan's header: the UUID's first eight hex digits."""
    return f"Tri-Cam: Plan {uuid.hex()[:8].upper()} Loaded"


# ----------------------------------------------------------------- the survey state table (what a plan's commands do)
def step(state: str, cfg: SeriesConfig, event: str, new_cfg: Optional[SeriesConfig] = None):
    """(next state, series config in force, accepted, effects). An AEC_Cal exit is taken as complete (it keeps what it
    learned) and leaves the exposure mode fixed."""
    mode3 = (new_cfg if event == "CFG" and new_cfg is not None else cfg).exposure_mode == 3
    for cond, nxt, accepted, effects in TABLE[state][event]:
        if cond is None or (cond == "mode3") == mode3:
            break
    else:
        return state, cfg, False, ()
    if "APPLY_CONFIG" in effects and new_cfg is not None:
        cfg = new_cfg
    if "EXIT_AEC_CAL" in effects:
        cfg = replace(cfg, exposure_mode=1)
    return nxt, cfg, accepted, effects


# ----------------------------------------------------------------- the rules
@dataclass
class Finding:
    rule: str    # rule id
    level: str   # ERROR | WARNING
    index: int   # plan item index (0 = the first item after home); -1 = the plan or the header as a whole
    text: str

    @property
    def code(self) -> str:
        return RULES[self.rule]["code"]

    @property
    def item(self) -> Optional[int]:
        """The mission sequence number the aircraft names (home is 0), or None for the plan as a whole."""
        return self.index + 1 if self.index >= 0 else None


def finding(rule: str, index: int, text: Optional[str] = None, **fields) -> Finding:
    r = RULES[rule]
    return Finding(rule, LEVEL[r["severity"]], index, text if text is not None else r["text"].format(**fields))


def operator_message(f: Finding) -> Optional[str]:
    """The Plan Loader's message for a finding on the aircraft; None for a file-only finding (the aircraft never sees
    the file)."""
    scope = RULES[f.rule]["scope"]
    if scope == "file":
        return None
    if scope == "header":
        return FORMS["header"].format(code=f.code)
    if f.level == "WARNING":
        return FORMS["warning"].format(code=f.code, item=f.index + 1)
    return FORMS["plan"].format(code=f.code) if f.index < 0 else FORMS["item"].format(code=f.code, item=f.index + 1)


def lint(items: List[dict]) -> List[Finding]:
    """The rules for a plan's items (the mission without home), in plan order."""
    out: List[Finding] = []
    m = parse_header(items)
    if m.status == "INVALID":
        out.append(finding("H-" + m.reason, -1, f"header invalid: {m.reason} ({RULES['H-' + m.reason]['text']})"))
    declared = m.status != "NO_HEADER"        # without a header the plan is not a Tri-Cam plan
    inflight = [i for i, it in enumerate(items) if is_inflight(it) and it["command"] != CMD_SINGLE]
    if m.status == "NO_HEADER" and inflight:
        out.append(finding("P-NO-HEADER", inflight[0]))
    nav = [i for i, it in enumerate(items) if it["command"] in NAV_COMMANDS]
    last_nav = nav[-1] if nav else -1
    starts = [i for i, it in enumerate(items) if it["command"] == CMD_START]
    ends = [i for i, it in enumerate(items) if it["command"] == CMD_FOCUS and it["params"][0] == 4]
    if declared and starts and not any(i < last_nav for i in ends):
        out.append(finding("P-NO-END", -1))
    state, last_tc, last_cmd, gap = IDLE, None, None, 0.0
    cfg = m.series if m.status == "OK" and m.series else DEFAULT
    cal_start, cal_budget, cal_nav = None, 0.0, False
    eff_mode = cfg.exposure_mode or 1                 # the exposure mode in force (0 in a word means "no change")
    words: dict = {}                                  # camera -> (where, SensorConfig): the last Sensor word for it
    for sn in (m.sensors if m.status == "OK" else []):
        w = ("header Sensor stanza", sn)
        for cam in ((0, 1, 2) if sn.channel == 3 else (sn.channel,)):
            words[cam] = w
    for i, it in enumerate(items):
        c, p = it["command"], it["params"]
        if declared and c == CMD_SINGLE and not (p[0] == 0 and p[1] == 0 and p[2] == 1):
            out.append(finding("P-SINGLE-FORM", i))
            continue
        if declared and c in FORBIDDEN:
            out.append(finding(FORBIDDEN[c], i))
            continue
        if c == CMD_DELAY:
            gap += p[0]; cal_budget += p[0]; continue
        if c in NAV_COMMANDS:
            gap = float("inf")                        # flying to the next waypoint separates commands in time
            cal_nav = True
            continue
        if not is_inflight(it): continue
        if i > last_nav:
            out.append(finding("P-AFTER-NAV", i))
        need = MIN_PHOTO_SPACING_S if (c == CMD_SINGLE and last_cmd == CMD_SINGLE) else MIN_PACING_S
        if last_tc is not None and gap + 1e-9 < need:
            what = "#2000" if need == MIN_PHOTO_SPACING_S else "Tri-Cam command"
            out.append(finding("P-PACING", i, need=need, what=what, previous=last_tc + 1))
        last_tc, last_cmd, gap = i, c, 0.0
        if declared and c in (CMD_START, CMD_PAUSE) and p[0] != 0:
            out.append(finding("P-START-P1", i, name="Start" if c == CMD_START else "Pause"))
        try:
            new_cfg, new_sensor = None, None
            if c == CMD_CFG and p[0] == 1:
                new_cfg = SeriesConfig.decode(int(p[1])); event = "CFG"
            elif c == CMD_CFG:
                new_sensor = SensorConfig.decode(int(p[1])); event = "CFG"
            else:
                event = {CMD_START: "START", CMD_PAUSE: "PAUSE", CMD_SINGLE: "SINGLE", CMD_FOCUS: "END"}[c]
        except (WordError, ValueError, OverflowError) as e:
            out.append(finding("P-BAD-WORD", i, error=e)); continue
        if state == AEC_CAL and event in ("CFG", "START"):
            out.append(finding("P-CAL-BUSY", i, what="config word" if event == "CFG" else "Start", cal_start=cal_start + 1))
        elif state == AEC_CAL and event == "PAUSE" and not cal_nav:
            need = (cfg.aec_cal_frames or AEC_CAL_DEFAULT_FRAMES) * cfg.interval_s
            if cal_budget < need:
                est = int(cal_budget // cfg.interval_s)
                verdict = "its results are reverted" if est < AEC_CAL_MIN_FRAMES else "it commits a partial result"
                out.append(finding("P-CAL-SHORT", i, budget=f"{cal_budget:.1f}", frames=est, need=f"{need:.1f}", verdict=verdict))
        elif state == AEC_CAL and event == "SINGLE":
            out.append(finding("P-CAL-SINGLE", i))
        new, cfg2, ok, fx = step(state, cfg, event, new_cfg)
        if ok and "APPLY_CONFIG" in fx:
            if new_cfg is not None and new_cfg.exposure_mode != 0:
                eff_mode = new_cfg.exposure_mode
            elif new_sensor is not None:
                w = (f"item {i + 1}", new_sensor)
                for cam in ((0, 1, 2) if new_sensor.channel == 3 else (new_sensor.channel,)):
                    words[cam] = w
        if ok and ("BEGIN_SURVEY" in fx or "BEGIN_AEC_CAL" in fx):
            for w in {id(v): v for v in words.values()}.values():
                where, sn = w
                if eff_mode not in ((2, 3) if sn.bounds else (1,)):
                    out.append(finding("P-SENSOR-MODE", i, where=where, kind="AEC bounds" if sn.bounds else "fixed values",
                                       cameras="all cameras" if sn.channel == 3 else f"camera {sn.channel}", mode=eff_mode))
        if "EXIT_AEC_CAL" in fx:
            eff_mode = 1
            words.clear()
        if not ok:
            if not (state == AEC_CAL and event in ("CFG", "START", "SINGLE")):   # already reported above
                out.append(finding("P-REFUSED", i, event=event, state=state))
        elif event == "START" and state == ACTIVE:
            out.append(finding("P-START-NOOP", i))
        else:
            cfg = cfg2
            if new == AEC_CAL: cal_start, cal_budget, cal_nav = i, 0.0, False
        state = new
    return out


def check_annotations(annotation, header: Header) -> List[Finding]:
    """The optional annotation block is for people only; warn when it disagrees with the header."""
    if not isinstance(annotation, dict) or header.status != "OK": return []
    out = []
    if str(annotation.get(ANNOTATION_UUID, "")).lower() != uuid_text(header.uuid):
        out.append(finding("F-ANNOTATION-UUID", -1, annotation=annotation.get(ANNOTATION_UUID), header=uuid_text(header.uuid)))
    if annotation.get("interfaceVersion") != PROTOCOL_VERSION:
        out.append(finding("F-ANNOTATION-VERSION", -1))
    return out


# ----------------------------------------------------------------- the .plan file
def plan_params(params) -> List[float]:
    """QGroundControl writes a NaN parameter as null and uploads it as NaN: null reads as NaN."""
    if not isinstance(params, list) or len(params) != 7:
        raise PlanFileError("params must be a list of 7 numbers")
    out = []
    for x in params:
        if x is None:
            out.append(float("nan"))
        elif isinstance(x, (int, float)) and not isinstance(x, bool):
            out.append(float(x))
        else:
            raise PlanFileError(f"parameter {x!r} is not a number")
    return out


def read_plan(path: str):
    """(plan JSON, the SimpleItems as {command, params}, number of other mission items)."""
    try:
        with open(path, encoding="utf8") as f:
            plan = json.load(f)
        mission = plan["mission"]["items"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise PlanFileError(f"not a readable .plan file ({e.__class__.__name__}: {e})")
    items, other = [], 0
    for n, it in enumerate(mission):
        if not isinstance(it, dict) or it.get("type") != "SimpleItem":
            other += 1
            continue
        c = it.get("command")
        if isinstance(c, bool) or not (isinstance(c, int) or (isinstance(c, float) and c.is_integer())):
            raise PlanFileError(f"mission.items[{n}]: command must be an integer")
        try:
            items.append({"command": int(c), "params": plan_params(it.get("params"))})
        except PlanFileError as e:
            raise PlanFileError(f"mission.items[{n}]: {e}")
    return plan, items, other


def check(path: str) -> dict:
    plan, items, other = read_plan(path)
    h = parse_header(items)
    findings = lint(items) + check_annotations(plan.get(ANNOTATION_KEY), h)
    errors = sum(f.level == "ERROR" for f in findings)
    header = {"status": h.status}
    if h.status == "INVALID":
        header["reason"] = h.reason
    if h.status == "OK":
        header.update({"mission_uuid": uuid_text(h.uuid), "fingerprint": h.fingerprint, "items": h.item_count,
                       "plan_loaded_message": plan_loaded_message(h.uuid)})
    notes = []
    if h.status == "NO_HEADER":
        notes.append("no Tri-Cam header: not a Tri-Cam plan; no survey can run (single shots only, under a stand-in identity)")
    if other:
        notes.append(f"{other} mission item(s) other than SimpleItem (a QGroundControl pattern such as Survey) not checked: "
                     "QGroundControl expands them only when it uploads the plan, and item numbers above count SimpleItems only")
    return {"file": path, "plan_loader_build": PLAN_LOADER_BUILD, "result": "FAILED" if errors else "OK",
            "errors": errors, "warnings": len(findings) - errors, "header": header,
            "findings": [{"rule": f.rule, "code": f.code, "level": f.level, "item": f.item, "text": f.text,
                          "message": operator_message(f)} for f in findings],
            "notes": notes}


def print_report(r: dict) -> None:
    h = r["header"]
    if h["status"] == "OK":
        print(f"{r['file']}: Tri-Cam plan, mission {h['mission_uuid']}; the aircraft shows \"{h['plan_loaded_message']}\"")
    elif h["status"] == "INVALID":
        print(f"{r['file']}: Tri-Cam header invalid ({h['reason']})")
    for f in r["findings"]:
        where = "plan" if f["item"] is None else f"item {f['item']}"
        print(f"{f['level']}: {where}: [{f['rule']}] {f['text']}")
        print(f"    on the aircraft: {f['message']}" if f["message"] else "    (file only: the aircraft never sees it)")
    for n in r["notes"]:
        print(f"NOTE: {n}")
    print(f"{r['result']}: {r['errors']} error(s), {r['warnings']} warning(s)")


def stamp_plan(src: str, dst: str, new_uuid: Optional[bytes] = None) -> bytes:
    """A new mission UUID in a plan file's header (the same settings); everything else in the file is kept."""
    plan, items, _ = read_plan(src)
    h = parse_header(items)
    if h.status != "OK":
        raise WordError(f"the plan's Tri-Cam header does not parse ({h.status} {h.reason})")
    uuid = new_uuid or os.urandom(16)
    while uuid in (bytes(16), b"\xff" * 16):
        uuid = os.urandom(16)
    new = build_header(uuid, h.series, h.sensors)
    simple = [it for it in plan["mission"]["items"] if it.get("type") == "SimpleItem"]
    header_items = [it for it in simple if it["command"] == CMD_SCRIPT][:h.item_count]
    if len(new) != h.item_count or len(header_items) != h.item_count:
        raise WordError("the header's size changed; regenerate the plan")
    for it, n in zip(header_items, new):
        it["params"] = n["params"]
    if isinstance(plan.get(ANNOTATION_KEY), dict):
        plan[ANNOTATION_KEY][ANNOTATION_UUID] = uuid_text(uuid)
    with open(dst, "w", encoding="utf8") as f:
        json.dump(plan, f, indent=2)
        f.write("\n")
    return uuid


def main(argv: List[str]) -> int:
    args = argv[1:]
    try:
        if len(args) in (2, 3) and args[0] == "validate" and args[2:] in ([], ["--json"]):
            r = check(args[1])
            if args[2:]:
                print(json.dumps(r, indent=2))
            else:
                print_report(r)
            return 1 if r["errors"] else 0
        if len(args) in (3, 4) and args[0] == "stamp":
            uuid = stamp_plan(args[1], args[2], bytes.fromhex(args[3]) if len(args) == 4 else None)
            print(f"wrote {args[2]}: mission UUID {uuid_text(uuid)} (the aircraft shows \"{plan_loaded_message(uuid)}\")")
            return main([argv[0], "validate", args[2]])
    except PlanFileError as e:
        if "--json" in args:
            print(json.dumps({"file": args[1], "result": "UNREADABLE", "error": str(e)}, indent=2))
        else:
            print(f"{args[1]}: {e}", file=sys.stderr)
        return 2
    except (WordError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
