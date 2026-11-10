import { readFile } from 'node:fs/promises'

const [url, file, contentType] = process.argv.slice(2)
if (!url || !file || !contentType) process.exit(2)

const body = await readFile(file)
const response = await fetch(url, {
  method: 'PUT',
  headers: { 'content-type': contentType },
  body
})

console.log(`status=${response.status}`)
process.exit(response.status === 200 ? 0 : 1)
