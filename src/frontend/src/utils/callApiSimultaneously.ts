import axios from 'axios';
import { toast } from 'react-toastify';

// function that calls the api simultaneously
export default async function callApiSimultaneously(urls: any, data: any) {
  // eslint-disable-next-line no-promise-executor-return
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const retryFc = async (
    url: string,
    singleData: any,
    n: number,
  ): Promise<any> => {
    try {
      return await axios.put(url, singleData);
    } catch (err) {
      if (n === 1) throw err;
      delay(1000); // 1 sec delay
      // eslint-disable-next-line no-return-await
      return await retryFc(url, singleData, n - 1);
    }
  };

  const promises = urls.map(
    (url: any, index: any) => retryFc(url, data[index], 3), // 3 entries for each api call
  );

  try {
    const responses = await Promise.all(promises);
    return responses;
  } catch (err) {
    toast.error('Error occurred on image upload');
    throw err;
  }
}
