/* eslint-disable no-nested-ternary */
export default function prepareFormData(data: Record<string, any>) {
  const formData = Object.entries(data).reduce(
    (obj, [key, value]) => ({
      ...obj,
      [key]:
        value instanceof File
          ? value
          : Array.isArray(value) || typeof value === 'object'
            ? JSON.stringify(value)
            : value,
    }),
    {},
  );
  const formDataObj = new FormData();
  Object.keys(formData).forEach(key => {
    // @ts-ignore
    formDataObj.append(key, formData[key]);
  });
  return formDataObj;
}
