import { SerialPort } from 'serialport'
import { promisify } from 'util'

import { createDataFrame, readDataFrame } from './dataFrames.mjs'

const STATUS_PAR_ERR = 0x60
const STATUS_DEVICE_MODE_ERROR = 0x66
const STATUS_INVALID_CMD = 0x67
const STATUS_NOT_IMPLEMENTED = 0x69

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

          if (response.status === STATUS_PAR_ERR) throw new Error('Parity error')
          if (response.status === STATUS_DEVICE_MODE_ERROR) throw new Error('Device mode error')
          if (response.status === STATUS_INVALID_CMD) throw new Error('Invalid command')
          if (response.status === STATUS_NOT_IMPLEMENTED) throw new Error('Not implemented')

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

  async getChipId(): Promise<string> {
    const data = await this.sendCommand(1011, 0x0000)
    return data.toString('hex')
  }
}

export default Device
