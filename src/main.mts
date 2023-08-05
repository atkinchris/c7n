import Device from './Device.mjs'

const device = await Device.connect()
const chipId = await device.getChipId()
console.log(chipId)

await device.close()
