export function toSlug(title = '') {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function toDetailPath(type, subjectId, title) {
  const section = type === 'tv' || (typeof type === 'number' && type !== 1) ? 'series' : (type === 'movie' ? 'movies' : 'movies');
  const slug = toSlug(title);
  return slug ? `/${section}/watch/${slug}-${subjectId}` : `/${section}/watch/${subjectId}`;
}

export function getIdFromDetailSlug(slug = '') {
  if (!slug) return null;
  if (/^\d+$/.test(slug)) return slug;
  const endsWithId = slug.match(/-(\d+)$/);
  if (endsWithId) return endsWithId[1];
  const startsWithId = slug.match(/^(\d+)-/);
  if (startsWithId) return startsWithId[1];
  return slug;
}

export function getTitleFromDetailSlug(slug = '') {
  if (!slug) return '';
  const endsWithId = slug.match(/^(.+)-\d+$/);
  if (endsWithId) return endsWithId[1].replace(/-/g, ' ');
  return '';
}
