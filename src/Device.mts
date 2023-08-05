import { SerialPort } from 'serialport'
import { promisify } from 'util'

import { DataFrame, createDataFrame, readDataFrame } from './dataFrames.mjs'
import Status from './Status.mjs'

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

  async sendCommand(cmd: number, status: number, data = Buffer.alloc(0)): Promise<DataFrame> {
    await this.drain()

    const promise = new Promise<DataFrame>((resolve, reject) => {
      this.device.once('readable', () => {
        const frame = this.device.read() as Buffer | null
        if (!frame) return

        try {
          const response = readDataFrame(frame)

          if (response.cmd !== cmd) throw new Error('Command mismatch')

          if (response.status === Status.PAR_ERR) throw new Error('Parity error')
          if (response.status === Status.DEVICE_MODE_ERROR) throw new Error('Device mode error')
          if (response.status === Status.INVALID_CMD) throw new Error('Invalid command')
          if (response.status === Status.NOT_IMPLEMENTED) throw new Error('Not implemented')

          resolve(response)
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
    const response = await this.sendCommand(1011, 0x0000)
    return response.data.toString('hex')
  }

  async isInReaderMode(): Promise<boolean> {
    const response = await this.sendCommand(1002, 0x0000)
    return response.data[0] === 0x01
  }

  async enableReaderMode(): Promise<void> {
    await this.sendCommand(1001, 0x0000, Buffer.from([0x0001]))
    if (!(await this.isInReaderMode())) throw new Error('Failed to set reader mode')
  }

  async scanTag14A(): Promise<string> {
    const response = await this.sendCommand(2000, 0x0000)

    if (response.status === Status.HF_TAG_NO) throw new Error('No tag found')
    if (response.status === Status.HF_ERRCRC) throw new Error('Data CRC error')
    if (response.status === Status.HF_COLLISION) throw new Error('Collision error')
    if (response.status === Status.HF_ERRBCC) throw new Error('UID BCC error')
    if (response.status === Status.MF_ERRAUTH) throw new Error('Authentication error')
    if (response.status === Status.HF_ERRPARITY) throw new Error('Data parity error')
    if (response.status !== Status.HF_TAG_OK) throw new Error('Unknown error')

    // 'uid_size': data[10],
    // 'uid_hex': data[0:data[10]].hex(),
    // 'sak_hex': hex(data[12]).lstrip('0x').rjust(2, '0'),
    // 'atqa_hex': data[13:15].hex().upper(),

    return response.data.toString('hex')
  }
}

export default Device
