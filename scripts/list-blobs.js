import 'dotenv/config';
import { BlobServiceClient } from '@azure/storage-blob';

function buildConnectionString() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return process.env.AZURE_STORAGE_CONNECTION_STRING;
  }

  const name = process.env.AZURE_STORAGE_NAME;
  const key = process.env.AZURE_STORAGE_KEY;

  if (!name || !key) {
    throw new Error('Missing Azure credentials. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_NAME/AZURE_STORAGE_KEY.');
  }

  return `DefaultEndpointsProtocol=https;AccountName=${name};AccountKey=${key};EndpointSuffix=core.windows.net`;
}

async function main() {
  const conn = buildConnectionString();
  const containerName = process.env.AZURE_STORAGE_CONTAINER;
  const prefix = process.env.AZURE_STORAGE_PREFIX || '';

  if (!containerName) {
    throw new Error('AZURE_STORAGE_CONTAINER is required.');
  }

  const client = BlobServiceClient
    .fromConnectionString(conn)
    .getContainerClient(containerName);

  let count = 0;
  for await (const blob of client.listBlobsFlat({ prefix })) {
    console.log(blob.name);
    count += 1;
    if (count >= 200) break;
  }

  console.log(`listed=${count}`);
  console.log(`prefix=${prefix || '(empty)'}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
