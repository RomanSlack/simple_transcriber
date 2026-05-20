import keytar from 'keytar';

const SERVICE = 'simple-transcriber';
const ACCOUNT = 'openai-api-key';

export async function getApiKey(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function setApiKey(key: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, key);
}

export async function clearApiKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

export async function hasKey(): Promise<boolean> {
  return Boolean(await getApiKey());
}
