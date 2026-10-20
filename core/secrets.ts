const secretPatterns = [
  /(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /(\b(?:password|passwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*["']?)[^\s,"';&]+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function redactSecrets(value: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, '$1***'), value);
}
