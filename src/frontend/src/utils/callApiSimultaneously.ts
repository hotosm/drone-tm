import axios from 'axios';

// function that calls the api simultaneously
export default async function callApiSimultaneously(urls: any, data: any) {
  const promises = urls.map((url: any, index: any) =>
    axios.put(url, data[index]),
  );
  const responses = await Promise.all(promises);
  return responses;
}
