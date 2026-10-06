/** Saves text as a file from the browser (no server round-trip: the data is
 * already on the page). */
export function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL alive a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
