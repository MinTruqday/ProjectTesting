import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, type _Object } from '@aws-sdk/client-s3';
import { assertHostAllowed, parseEnv } from './gates.js';
import { appendJsonl, safeResolve } from './project.js';
import type { Project, StorageConfig } from './types.js';

export function expiredStorageObjects(objects: _Object[], prefix: string, cutoff: Date): _Object[] {
  return objects.filter(object => Boolean(object.Key?.startsWith(prefix)) && Boolean(object.LastModified && object.LastModified < cutoff));
}

export async function cleanProjectStorage(project: Project, projectDir: string, apply: boolean): Promise<number> {
  if (project.safety !== 'local') throw new Error('BLOCKED: storage cleanup chỉ chạy với safety=local.');
  const configFile = path.join(projectDir, 'storage.yaml');
  if (!fs.existsSync(configFile)) { console.log('Storage cleanup: chưa khai báo storage.yaml. Không có gì bị xóa.'); return 0; }
  const storage = YAML.parse(fs.readFileSync(configFile, 'utf8')) as StorageConfig;
  if (!storage?.enabled) { console.log('Storage cleanup đang tắt trong storage.yaml. Không có gì bị xóa.'); return 0; }
  const expectedPrefix = `qa_temp/${project.name}/`;
  if (storage.type !== 's3-compatible' || storage.prefix !== expectedPrefix || !storage.bucket) throw new Error(`BLOCKED: prefix phải khớp chính xác ${expectedPrefix}, type/bucket phải khai báo.`);
  if (!Number.isInteger(storage.retention_hours) || storage.retention_hours < 12 || storage.retention_hours > 24) throw new Error('BLOCKED: retention_hours phải từ 12 đến 24 giờ.');
  const endpoint = assertHostAllowed(storage.endpoint, project.allow_hosts);
  if (!['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname)) throw new Error('BLOCKED: storage cleanup chỉ nhận MinIO/S3 local loopback.');
  const envPath = safeResolve(projectDir, storage.env_file || '.env.storage');
  const env = parseEnv(envPath);
  const accessKey = process.env[storage.access_key_env] || env[storage.access_key_env];
  const secretKey = process.env[storage.secret_key_env] || env[storage.secret_key_env];
  if (!accessKey || !secretKey) throw new Error(`BLOCKED: thiếu khóa ${[!accessKey ? storage.access_key_env : '', !secretKey ? storage.secret_key_env : ''].filter(Boolean).join(', ')}; giá trị không được in.`);
  const client = new S3Client({ endpoint: endpoint.toString(), region: storage.region ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
  const cutoff = new Date(Date.now() - storage.retention_hours * 60 * 60 * 1000);
  const expired: _Object[] = [];
  let token: string | undefined;
  try {
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: storage.prefix, ContinuationToken: token, MaxKeys: 1000 }));
      expired.push(...expiredStorageObjects(page.Contents ?? [], storage.prefix, cutoff));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    if (!apply) {
      console.log(`DRY-RUN: ${expired.length} object(s) cũ hơn ${storage.retention_hours}h trong prefix ${storage.prefix}. Chạy thêm --apply để xóa.`);
      return expired.length;
    }
    for (let start = 0; start < expired.length; start += 1000) {
      const batch = expired.slice(start, start + 1000);
      if (batch.some(item => !item.Key?.startsWith(expectedPrefix))) throw new Error('BLOCKED: object key vượt prefix test an toàn.');
      await client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: batch.map(item => ({ Key: item.Key! })), Quiet: true } }));
      for (const item of batch) appendJsonl(path.join(projectDir, 'runs', new Date().toISOString().slice(0, 10), 'storage-cleanup.jsonl'), { key: item.Key, last_modified: item.LastModified?.toISOString(), deleted_at: new Date().toISOString(), retention_hours: storage.retention_hours });
    }
    console.log(`Đã xóa ${expired.length} object(s) cũ hơn ${storage.retention_hours}h trong prefix test.`);
    return expired.length;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(accessKey, '***').replace(secretKey, '***') : 'Storage cleanup failed.';
    throw new Error(`Storage cleanup thất bại: ${message}`);
  } finally { client.destroy(); }
}
