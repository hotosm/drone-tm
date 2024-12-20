import EXIFReader from 'exifreader';

interface EXIFTags {
  DateTime?: { description: string };
  Coordinates?: { description: string };
  GPSLatitude?: { description: number };
  GPSLongitude?: { description: number };
  [key: string]: any;
}

const normalizeDatetime = (datetime: string): string => {
  // Replace ':' with '-' in the date part
  const [date, time] = datetime.split(' ');
  const normalizedDate = date.replace(/:/g, '-');
  return `${normalizedDate}T${time}`;
};

const getExifData = (file: File): Promise<any> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      try {
        const arrayBuffer = e.target!.result as ArrayBuffer;
        const tags = EXIFReader.load(arrayBuffer) as EXIFTags;

        const dateTime = tags.DateTime?.description;
        let gpsLatitude = tags.GPSLatitude?.description;
        const gpsLatitudeRef = tags.GPSLatitudeRef?.value;
        let gpsLongitude = tags.GPSLongitude?.description;
        const gpsLongitudeRef = tags.GPSLongitudeRef?.value;

        if (gpsLatitudeRef[0] === 'S' && gpsLatitude) {
          gpsLatitude = -gpsLatitude;
        }
        if (gpsLongitudeRef[0] === 'W' && gpsLongitude) {
          gpsLongitude = -gpsLongitude;
        }

        if (gpsLatitude && gpsLongitude) {
          const latitude = gpsLatitude;
          const longitude = gpsLongitude;
          resolve({
            file,
            dateTime: normalizeDatetime(dateTime || ''),
            coordinates: { longitude, latitude },
          });
        } else {
          resolve({
            file,
            dateTime: normalizeDatetime(dateTime || ''),
            coordinates: { longitude: null, latitude: null },
          });
        }
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = error => reject(error);

    // Start reading the file
    reader.readAsArrayBuffer(file);
  });
};

export default getExifData;
