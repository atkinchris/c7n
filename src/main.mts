import Device from './Device.mjs'

const device = await Device.connect()
const data = await device.sendCommand(1000, 0x00)
console.log(data.readInt16LE(0))

await device.close()
