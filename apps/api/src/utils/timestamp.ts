// Subgraph timestamps are unix seconds; convert to milliseconds.
export const parseTimestamp = (value: string | number) => Number(value) * 1000;
