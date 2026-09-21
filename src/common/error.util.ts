/** Chuẩn hóa giá trị được bắt trong catch thành đối tượng Error. */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'string') {
    return new Error(value);
  }

  return new Error('Đã xảy ra lỗi không xác định');
}
