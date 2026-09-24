/**
 * Parses the Central Directory of a ZIP archive in memory (without decompressing the files)
 * to validate file path traversals (Zip Slip) and total uncompressed size (Zip Bomb).
 */
export function validateZipArchive(
  data: Uint8Array,
  maxUncompressedSize: number
): { fileCount: number; totalSize: number } {
  const len = data.length

  // 1. Search for End of Central Directory (EOCD) signature (0x06054b50) from the end
  let eocdOffset = -1
  for (let i = len - 22; i >= Math.max(0, len - 65535 - 22); i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4B &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) {
    throw createError({
      statusCode: 400,
      message: 'Invalid zip file: EOCD record not found',
    })
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // Total number of central directory records
  const totalRecords = view.getUint16(eocdOffset + 10, true)
  // Size of central directory
  const cdSize = view.getUint32(eocdOffset + 12, true)
  // Offset of central directory
  const cdOffset = view.getUint32(eocdOffset + 16, true)

  if (cdOffset + cdSize > len) {
    throw createError({
      statusCode: 400,
      message: 'Invalid zip file: central directory out of bounds',
    })
  }

  let currentOffset = cdOffset
  let totalUncompressedSize = 0
  let fileCount = 0

  // 2. Iterate through each Central Directory entry
  for (let r = 0; r < totalRecords; r++) {
    if (currentOffset + 46 > len) {
      throw createError({
        statusCode: 400,
        message: 'Invalid zip file: truncated central directory header',
      })
    }

    const sig = view.getUint32(currentOffset, true)
    if (sig !== 0x02014B50) {
      throw createError({
        statusCode: 400,
        message: `Invalid zip file: incorrect central directory signature at offset ${currentOffset}`,
      })
    }

    const uncompressedSize = view.getUint32(currentOffset + 24, true)
    const nameLen = view.getUint16(currentOffset + 28, true)
    const extraLen = view.getUint16(currentOffset + 30, true)
    const commentLen = view.getUint16(currentOffset + 32, true)

    const recordSize = 46 + nameLen + extraLen + commentLen
    if (currentOffset + recordSize > len) {
      throw createError({
        statusCode: 400,
        message: 'Invalid zip file: central directory record out of bounds',
      })
    }

    // Extract filename and check for path traversal
    const fileNameBytes = data.subarray(currentOffset + 46, currentOffset + 46 + nameLen)
    const fileName = new TextDecoder().decode(fileNameBytes).replace(/\\/g, '/')

    if (
      fileName.includes('..') ||
      fileName.startsWith('/') ||
      fileName.startsWith('\\') ||
      /^[a-z]:/i.test(fileName) // Block Windows drive letters (e.g. C:)
    ) {
      throw createError({
        statusCode: 400,
        message: `Directory traversal detected in zip entry: ${fileName}`,
      })
    }

    totalUncompressedSize += uncompressedSize
    fileCount++

    if (totalUncompressedSize > maxUncompressedSize) {
      throw createError({
        statusCode: 413,
        message: `Decompression limit exceeded: total uncompressed size exceeds ${Math.floor(
          maxUncompressedSize / (1024 * 1024)
        )} MB`,
      })
    }

    currentOffset += recordSize
  }

  return { fileCount, totalSize: totalUncompressedSize }
}
