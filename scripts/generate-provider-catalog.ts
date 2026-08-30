import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import catalog from '../src-tauri/resources/provider-catalog.json'

async function main() {
  const output = resolve(process.argv[2] ?? 'src-tauri/resources/provider-catalog.json')
  const ids = new Set(catalog.map((provider) => provider.id))
  const modelCount = catalog.reduce((count, provider) => count + provider.models.length, 0)

  if (catalog.length !== 178 || ids.size !== 178 || modelCount !== 5_482) {
    throw new Error(
      `Refusing to write an incomplete provider catalog: providers=${catalog.length}, unique=${ids.size}, models=${modelCount}`,
    )
  }

  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(catalog)}\n`)
  console.log(`Validated ${output}: ${ids.size} providers and ${modelCount} models`)
}

void main()
