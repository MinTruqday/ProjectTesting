export type Safety = 'local' | 'shared-dev' | 'read-only';
export type Project = {
  name: string;
  description?: string;
  repo?: string;
  branch?: string;
  safety: Safety;
  base_url: string;
  allow_hosts: string[];
  health: string[];
  env_file: string;
  required_env: string[];
  roles?: Record<string, { user_env?: string; pass_env?: string; login?: string }>;
  adapters?: Record<string, unknown>;
  schedule?: Record<string, string>;
  plugins?: Record<string, unknown>;
};

export type StorageConfig = {
  enabled: boolean;
  type: 's3-compatible';
  endpoint: string;
  region?: string;
  bucket: string;
  prefix: string;
  env_file: string;
  access_key_env: string;
  secret_key_env: string;
  retention_hours: number;
};

export type TestCase = {
  id: string;
  title: string;
  module?: string;
  role?: string;
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
  severity?: string;
  technique?: string;
  basis?: string;
  type?: 'Auto' | 'Manual';
  status?: string;
  description?: string;
  steps?: unknown[];
  expect?: unknown[];
  tags?: string[];
  mutates?: boolean;
  data_prefix?: string;
};

export type Result = {
  execution_id?: string;
  run_id?: string;
  id: string;
  date: string;
  project: string;
  module: string;
  status: 'Pass' | 'Fail' | 'Blocked' | 'Chưa chạy';
  actual?: string;
  commit?: string;
  type: 'Auto' | 'Manual';
  priority: string;
  severity: string;
  evidence?: string[];
  bug_id?: string;
  duration_ms?: number;
  role?: string;
};
