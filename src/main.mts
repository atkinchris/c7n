import Device from './Device.mjs'

const device = await Device.connect()
await device.enableReaderMode()
console.log(await device.scanTag14A())

await device.close()
