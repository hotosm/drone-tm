export default function sortByDatetime(
  arr: Record<string, any>[],
): Record<string, any>[] {
  // Create a shallow copy of the array to avoid modifying the original
  const arrCopy = [...arr];

  return arrCopy.sort((a, b) => {
    const dateA = new Date(a.dateTime);
    const dateB = new Date(b.dateTime);

    // Make sure both are valid Date objects
    if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) {
      return 0; // Avoid invalid date comparison
    }

    // Compare the Date objects by their time in milliseconds
    return dateA.getTime() - dateB.getTime();
  });
}
