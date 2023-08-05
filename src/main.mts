const calculateLRC = (bytes: Buffer): number => {
  let ret = 0x00
  for (const b of bytes) {
    ret += b
    ret &= 0xff
  }
  return (0x100 - ret) & 0xff
}

const createDataFrame = (cmd: number, status: number, data = []) => {
  // Frame size
  // 2 bytes for start of frame (SOF) & SOF LRC
  // 6 bytes for header (command & status & data length)
  // 1 byte for header LRC
  // 0..n bytes for data
  const frame = Buffer.alloc(2 + 6 + 1 + data.length)
  const sof = 0x11 // start of frame (SOF)

  // Start of Frame (SOF)
  frame.writeUInt8(sof, 0)
  frame.writeUInt8(calculateLRC(frame.subarray(0, 1)), 1)

  // Write header (command & status & data length) to frame
  frame.writeUInt16BE(cmd, 2)
  frame.writeUInt16BE(status, 4)
  frame.writeUInt16BE(data.length, 6)

  // Calculate header LRC and write to frame
  frame.writeUInt8(calculateLRC(frame.subarray(2, 8)), 8)

  // Write data to frame (if present)
  for (let i = 0; i < data.length; i++) {
    frame.writeUInt8(data[i], 9 + i)
  }

  // Return the frame, appended with the LRC for the whole frame
  return Buffer.from([...frame, calculateLRC(frame)])
}

console.log(createDataFrame(1000, 0x00).toString('hex'))
