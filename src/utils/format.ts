const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Format a non-negative byte count with consistent binary units across the UI. */
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;
  return `${parseFloat(value.toFixed(Math.max(0, decimals)))} ${BYTE_UNITS[unit]}`;
};

export const splitSpeed = (bytesPerSecond: number, decimals = 1) => {
  const [value, unit = 'B'] = formatBytes(bytesPerSecond, decimals).split(' ');
  return { value, unit: `${unit}/s` };
};

export const formatSpeed = (bytesPerSecond: number, decimals = 1): string => {
  const speed = splitSpeed(bytesPerSecond, decimals);
  return `${speed.value} ${speed.unit}`;
};
