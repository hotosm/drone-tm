export default function formatNumberWithCommas(x: number) {
  return new Intl.NumberFormat('en-IN').format(x);
}
