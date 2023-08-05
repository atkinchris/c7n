import { SerialPort } from 'serialport'
import { promisify } from 'util'

import { createDataFrame, readDataFrame } from './dataFrames.mjs'

class Device {
  private device: SerialPort

  static connect = async (): Promise<Device> => {
    const ports = await SerialPort.list()
    const port = ports.find(port => port.manufacturer === 'Proxgrind')
    if (!port) throw new Error('No Chameleon device found')
    return new Device(port.path)
  }

  constructor(path: string) {
    this.device = new SerialPort({ path, baudRate: 115200 })
  }

  async drain(): Promise<void> {
    await promisify(this.device.drain.bind(this.device))()
  }

  async sendCommand(cmd: number, status: number, data = Buffer.alloc(0)): Promise<Buffer> {
    await this.drain()

    const promise = new Promise<Buffer>((resolve, reject) => {
      this.device.once('readable', () => {
        const frame = this.device.read() as Buffer | null
        if (!frame) return

        try {
          const response = readDataFrame(frame)

          if (response.cmd !== cmd) throw new Error('Command mismatch')
          if (response.status !== status) throw new Error('Status mismatch')

          resolve(response.data)
        } catch (err) {
          reject(err)
        }
      })
    })

    const frame = createDataFrame(cmd, status, data)
    this.device.write(frame)

    return promise
  }

  async close(): Promise<void> {
    await promisify(this.device.close.bind(this.device))()
  }
}

export default Device
