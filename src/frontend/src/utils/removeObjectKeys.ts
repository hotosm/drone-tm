export default function removeObjectKeys(
  data: Record<string, any>,
  keyArr: string[],
) {
  return Object.keys(data).reduce(
    (obj, key) =>
      keyArr.includes(key) ? { ...obj } : { ...obj, [key]: data[key] },
    {},
  );
}
