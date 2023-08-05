enum Status {
  // Device statuses
  PAR_ERR = 0x60,
  DEVICE_MODE_ERROR = 0x66,
  INVALID_CMD = 0x67,
  NOT_IMPLEMENTED = 0x69,
  // High frequency statuses
  HF_TAG_OK = 0x00,
  HF_TAG_NO = 0x01,
  HF_ERRSTAT = 0x02,
  HF_ERRCRC = 0x03,
  HF_COLLISION = 0x04,
  HF_ERRBCC = 0x05,
  MF_ERRAUTH = 0x06,
  HF_ERRPARITY = 0x07,
}

export default Status
