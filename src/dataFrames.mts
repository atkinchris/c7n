import Status from './Status.mjs'

const SOF = 0x11 // start of frame (SOF)

interface DataFrame {
  cmd: number
  status: Status
  data: Buffer
}

const calculateLRC = (bytes: Buffer): number => {
  let ret = 0x00
  for (const b of bytes) {
    ret += b
    ret &= 0xff
  }
  return (0x100 - ret) & 0xff
}

const createDataFrame = (cmd: number, status: number, data = Buffer.alloc(0)) => {
  // Frame size
  // 2 bytes for start of frame (SOF) & SOF LRC
  // 6 bytes for header (command & status & data length)
  // 1 byte for header LRC
  // 0..n bytes for data
  const frame = Buffer.alloc(2 + 6 + 1 + data.length)

  // Start of Frame (SOF)
  frame.writeUInt8(SOF, 0)
  frame.writeUInt8(calculateLRC(frame.subarray(0, 1)), 1)

  // Write header (command & status & data length) to frame
  frame.writeUInt16BE(cmd, 2)
  frame.writeUInt16BE(status, 4)
  frame.writeUInt16BE(data.length, 6)

  // Calculate header LRC and write to frame
  frame.writeUInt8(calculateLRC(frame.subarray(2, 8)), 8)

  // Write data to frame (if present)
  frame.set(data, 9)

  // Return the frame, appended with the LRC for the whole frame
  return Buffer.from([...frame, calculateLRC(frame)])
}

const readDataFrame = (frame: Buffer): DataFrame => {
  const sof = frame.readUInt8(0)
  const sofLRC = frame.readUInt8(1)

  if (sof !== SOF || sofLRC !== calculateLRC(frame.subarray(0, 1))) {
    throw new Error('SOF mismatch')
  }

  const frameLrc = frame.readUInt8(frame.length - 1)
  if (frameLrc !== calculateLRC(frame.subarray(0, frame.length - 1))) {
    throw new Error('Frame LRC mismatch')
  }

  const cmd = frame.readUInt16BE(2)
  const status = frame.readUInt16BE(4)
  const dataLength = frame.readUInt16BE(6)
  const headerLRC = frame.readUInt8(8)

  if (headerLRC !== calculateLRC(frame.subarray(2, 8))) {
    throw new Error('Header LRC mismatch')
  }

  const data = frame.subarray(9, 9 + dataLength)

  return { cmd, status, data }
}

export { createDataFrame, readDataFrame, DataFrame }
