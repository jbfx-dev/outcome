Drop player headshots here, named by team (lowercase, non-letters -> hyphens):

  england.png     (Bellingham)
  argentina.png   (Messi)
  spain.png       (Yamal)

(.png is tried first; .jpg works as a fallback)

Any aspect ratio works - the page crops to a head-and-shoulders circle via CSS
(object-fit: cover; object-position: 50% 12%). If a file is missing the avatar
slot hides itself, so nothing breaks. Add more teams the same way if the
bracket changes (e.g. france.png).
