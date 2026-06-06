.pragma library

// ============================================================================
// Minimal KMZ (ZIP) builder for QML JS
// Creates an uncompressed ZIP containing wpmz/waylines.wpml
// ============================================================================

// CRC-32 lookup table (lazily initialized)
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

// Convert string to UTF-8 byte array
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
    buf[offset] = value & 0xFF
    buf[offset + 1] = (value >>> 8) & 0xFF
}

function _writeU32(buf, offset, value) {
    buf[offset] = value & 0xFF
    buf[offset + 1] = (value >>> 8) & 0xFF
    buf[offset + 2] = (value >>> 16) & 0xFF
    buf[offset + 3] = (value >>> 24) & 0xFF
}

// Create a KMZ file (ZIP containing wpmz/waylines.wpml)
// Returns an ArrayBuffer suitable for binary file writing
function createKmz(wpmlXml) {
    var filename = "wpmz/waylines.wpml"
    var fnBytes = _stringToBytes(filename)
    var dataBytes = _stringToBytes(wpmlXml)
    var crc = _crc32(dataBytes)

    // Sizes
    var localHeaderLen = 30 + fnBytes.length
    var centralHeaderLen = 46 + fnBytes.length
    var eocdLen = 22
    var totalSize = localHeaderLen + dataBytes.length + centralHeaderLen + eocdLen

    var buf = new Uint8Array(totalSize)
    var o = 0

    // --- Local file header ---
    _writeU32(buf, o, 0x04034B50); o += 4   // signature
    _writeU16(buf, o, 20);         o += 2   // version needed (2.0)
    _writeU16(buf, o, 0);          o += 2   // flags
    _writeU16(buf, o, 0);          o += 2   // compression: STORE
    _writeU16(buf, o, 0);          o += 2   // mod time
    _writeU16(buf, o, 0);          o += 2   // mod date
    _writeU32(buf, o, crc);        o += 4   // CRC-32
    _writeU32(buf, o, dataBytes.length); o += 4  // compressed size
    _writeU32(buf, o, dataBytes.length); o += 4  // uncompressed size
    _writeU16(buf, o, fnBytes.length);   o += 2  // filename length
    _writeU16(buf, o, 0);          o += 2   // extra field length

    // filename
    for (var i = 0; i < fnBytes.length; i++) buf[o++] = fnBytes[i]
    // file data
    for (var j = 0; j < dataBytes.length; j++) buf[o++] = dataBytes[j]

    // --- Central directory header ---
    var centralDirStart = o
    _writeU32(buf, o, 0x02014B50); o += 4   // signature
    _writeU16(buf, o, 20);         o += 2   // version made by
    _writeU16(buf, o, 20);         o += 2   // version needed
    _writeU16(buf, o, 0);          o += 2   // flags
    _writeU16(buf, o, 0);          o += 2   // compression
    _writeU16(buf, o, 0);          o += 2   // mod time
    _writeU16(buf, o, 0);          o += 2   // mod date
    _writeU32(buf, o, crc);        o += 4   // CRC-32
    _writeU32(buf, o, dataBytes.length); o += 4  // compressed size
    _writeU32(buf, o, dataBytes.length); o += 4  // uncompressed size
    _writeU16(buf, o, fnBytes.length);   o += 2  // filename length
    _writeU16(buf, o, 0);          o += 2   // extra field length
    _writeU16(buf, o, 0);          o += 2   // file comment length
    _writeU16(buf, o, 0);          o += 2   // disk number start
    _writeU16(buf, o, 0);          o += 2   // internal attributes
    _writeU32(buf, o, 0);          o += 4   // external attributes
    _writeU32(buf, o, 0);          o += 4   // offset of local header

    for (var k = 0; k < fnBytes.length; k++) buf[o++] = fnBytes[k]

    // --- End of central directory ---
    var centralDirSize = o - centralDirStart
    _writeU32(buf, o, 0x06054B50); o += 4   // signature
    _writeU16(buf, o, 0);          o += 2   // disk number
    _writeU16(buf, o, 0);          o += 2   // disk where central dir starts
    _writeU16(buf, o, 1);          o += 2   // entries on this disk
    _writeU16(buf, o, 1);          o += 2   // total entries
    _writeU32(buf, o, centralDirSize);     o += 4  // central dir size
    _writeU32(buf, o, centralDirStart);    o += 4  // central dir offset
    _writeU16(buf, o, 0);          o += 2   // comment length

    return buf.buffer
}
