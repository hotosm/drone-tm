export default function capitalizeFirstLetter(word: string): string {
  return word
    .split('_')
    .map(str => `${str.charAt(0).toUpperCase()}${str.slice(1)}`)
    .join(' ');
}
