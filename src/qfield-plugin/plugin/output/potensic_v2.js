.pragma library

// ============================================================================
// Potensic Atom 2 JSON waypoint output format
// Port of output/potensic_v2.py
// ============================================================================

// --- ZIP building primitives (same algorithm as kmz.js, supports N files) ---

var _crcTable = null

function _makeCrcTable() {
    var table = new Array(256)
    for (var n = 0; n < 256; n++) {
        var c = n
        for (var k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1))
        }
        table[n] = c >>> 0
    }
    return table
}

function _crc32(bytes) {
    if (!_crcTable) _crcTable = _makeCrcTable()
    var crc = 0xFFFFFFFF
    for (var i = 0; i < bytes.length; i++) {
        crc = (_crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

function _stringToBytes(str) {
    var bytes = []
    for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i)
        if (code < 0x80) {
            bytes.push(code)
        } else if (code < 0x800) {
            bytes.push(0xC0 | (code >> 6))
            bytes.push(0x80 | (code & 0x3F))
        } else {
            bytes.push(0xE0 | (code >> 12))
            bytes.push(0x80 | ((code >> 6) & 0x3F))
            bytes.push(0x80 | (code & 0x3F))
        }
    }
    return bytes
}

function _writeU16(buf, offset, value) {
    buf[offset]     = value & 0xFF
    buf[offset + 1] = (value >>> 8) & 0xFF
}

function _writeU32(buf, offset, value) {
    buf[offset]     = value & 0xFF
    buf[offset + 1] = (value >>> 8) & 0xFF
    buf[offset + 2] = (value >>> 16) & 0xFF
    buf[offset + 3] = (value >>> 24) & 0xFF
}

// Build a ZIP from an array of {name: string, data: string} entries.
// Returns an ArrayBuffer (stored, uncompressed).
function buildZip(entries) {
    // Precompute per-entry byte arrays and CRCs
    var infos = []
    for (var i = 0; i < entries.length; i++) {
        var fnBytes   = _stringToBytes(entries[i].name)
        var dataBytes = _stringToBytes(entries[i].data)
        infos.push({ fnBytes: fnBytes, dataBytes: dataBytes, crc: _crc32(dataBytes) })
    }

    // Compute local-header offsets
    var localOffsets = []
    var pos = 0
    for (var i = 0; i < infos.length; i++) {
        localOffsets.push(pos)
        pos += 30 + infos[i].fnBytes.length + infos[i].dataBytes.length
    }
    var centralDirStart = pos

    // Total size
    var centralDirSize = 0
    for (var i = 0; i < infos.length; i++) {
        centralDirSize += 46 + infos[i].fnBytes.length
    }
    var totalSize = centralDirStart + centralDirSize + 22

    var buf = new Uint8Array(totalSize)
    var o = 0

    // Local file headers + data
    for (var i = 0; i < infos.length; i++) {
        var fi = infos[i]
        _writeU32(buf, o, 0x04034B50); o += 4   // local header sig
        _writeU16(buf, o, 20);         o += 2   // version needed
        _writeU16(buf, o, 0);          o += 2   // flags
        _writeU16(buf, o, 0);          o += 2   // compression: STORE
        _writeU16(buf, o, 0);          o += 2   // mod time
        _writeU16(buf, o, 0);          o += 2   // mod date
        _writeU32(buf, o, fi.crc);     o += 4   // CRC-32
        _writeU32(buf, o, fi.dataBytes.length); o += 4  // compressed size
        _writeU32(buf, o, fi.dataBytes.length); o += 4  // uncompressed size
        _writeU16(buf, o, fi.fnBytes.length);   o += 2  // filename length
        _writeU16(buf, o, 0);          o += 2   // extra field length
        for (var j = 0; j < fi.fnBytes.length;  j++) buf[o++] = fi.fnBytes[j]
        for (var j = 0; j < fi.dataBytes.length; j++) buf[o++] = fi.dataBytes[j]
    }

    // Central directory entries
    for (var i = 0; i < infos.length; i++) {
        var fi = infos[i]
        _writeU32(buf, o, 0x02014B50); o += 4   // central dir sig
        _writeU16(buf, o, 20);         o += 2   // version made by
        _writeU16(buf, o, 20);         o += 2   // version needed
        _writeU16(buf, o, 0);          o += 2   // flags
        _writeU16(buf, o, 0);          o += 2   // compression
        _writeU16(buf, o, 0);          o += 2   // mod time
        _writeU16(buf, o, 0);          o += 2   // mod date
        _writeU32(buf, o, fi.crc);     o += 4   // CRC-32
        _writeU32(buf, o, fi.dataBytes.length); o += 4  // compressed size
        _writeU32(buf, o, fi.dataBytes.length); o += 4  // uncompressed size
        _writeU16(buf, o, fi.fnBytes.length);   o += 2  // filename length
        _writeU16(buf, o, 0);          o += 2   // extra field length
        _writeU16(buf, o, 0);          o += 2   // file comment length
        _writeU16(buf, o, 0);          o += 2   // disk number start
        _writeU16(buf, o, 0);          o += 2   // internal attributes
        _writeU32(buf, o, 0);          o += 4   // external attributes
        _writeU32(buf, o, localOffsets[i]); o += 4  // local header offset
        for (var j = 0; j < fi.fnBytes.length; j++) buf[o++] = fi.fnBytes[j]
    }

    // End of central directory
    _writeU32(buf, o, 0x06054B50); o += 4   // EOCD sig
    _writeU16(buf, o, 0);          o += 2   // disk number
    _writeU16(buf, o, 0);          o += 2   // disk where central dir starts
    _writeU16(buf, o, infos.length); o += 2 // entries on this disk
    _writeU16(buf, o, infos.length); o += 2 // total entries
    _writeU32(buf, o, centralDirSize);   o += 4  // central dir size
    _writeU32(buf, o, centralDirStart);  o += 4  // central dir offset
    _writeU16(buf, o, 0);          o += 2   // comment length

    return buf.buffer
}

// --- Potensic JSON format ---

function createGlobalJson(defaultSpeed) {
    return JSON.stringify({
        finishAction:   "RETURN",
        globalHeight:   0,
        globalHeightType: 0,
        isOrder:        true,
        lostAction:     "RETURN",
        speed:          defaultSpeed
    }, null, 2)
}

function createMissionJson(featcol, defaultSpeed, timestampMs) {
    var features = featcol.features || []
    var waypoints = []

    for (var i = 0; i < features.length; i++) {
        var feature = features[i]
        var props  = feature.properties || {}
        var coords = feature.geometry.coordinates

        if (coords.length < 3) continue

        var lng    = coords[0]
        var lat    = coords[1]
        var height = coords[2]

        var action = props.take_photo ? "PHOTO" : "NONE"

        var gimbalAngle = (props.gimbal_angle !== undefined) ? props.gimbal_angle : -80
        var gimbalPitch = Math.round(parseFloat(gimbalAngle))
        if (isNaN(gimbalPitch)) gimbalPitch = -80

        var speed     = (props.speed !== undefined) ? props.speed : defaultSpeed
        var speedType = (props.speed !== undefined) ? "DEFINE" : "GLOBAL"

        waypoints.push({
            action:     action,
            fileName:   "point_" + timestampMs + ".jpg",
            gimbalPitch: gimbalPitch,
            gimbalType: "DEFINE",
            height:     height,
            hoverTime:  (props.hover_time !== undefined) ? props.hover_time : 0,
            lat:        lat,
            lng:        lng,
            poiHeight:  0.0,
            poiLat:     0.0,
            poiLng:     0.0,
            poiType:    0,
            speed:      speed,
            speedType:  speedType,
            yaw:        (props.heading !== undefined) ? props.heading : 0,
            yawType:    "DEFINE",
            zoomRatio:  1.0,
            zoomType:   "DEFINE"
        })
    }

    return JSON.stringify(waypoints) + ";" + JSON.stringify([])
}

// Create a ZIP with two files:
//   {timestampMs}/global.json
//   {timestampMs}/{timestampMs}.json
//
// Returns {zipData, globalJson, missionJson, timestampMs}
function createPotensicZip(featcol, defaultSpeed, timestampMs) {
    if (!timestampMs) timestampMs = Date.now()
    var ts = String(timestampMs)

    var globalJson  = createGlobalJson(defaultSpeed)
    var missionJson = createMissionJson(featcol, defaultSpeed, timestampMs)

    var zipData = buildZip([
        { name: ts + "/global.json", data: globalJson },
        { name: ts + "/" + ts + ".json", data: missionJson }
    ])

    return { zipData: zipData, globalJson: globalJson, missionJson: missionJson, timestampMs: timestampMs }
}
