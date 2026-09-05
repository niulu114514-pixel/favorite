export class MemoryKV {
  constructor(entries = {}) {
    this.data = new Map(Object.entries(entries))
  }

  async get(key) {
    return this.data.get(key) ?? null
  }

  async put(key, value) {
    this.data.set(key, value)
  }

  async delete(key) {
    this.data.delete(key)
  }
}

export function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
