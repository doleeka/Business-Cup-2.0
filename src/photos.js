// Finds real food photos (Unsplash, via /api/recipe-photo) for recipes that have none.

export async function findPhoto(recipe) {
  const res = await fetch('/api/recipe-photo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: recipe.name, category: recipe.category, ingredients: recipe.ingredients.map((x) => x[0]) }),
  });
  const data = await res.json().catch(() => ({ error: 'Unexpected server response' }));
  if (!res.ok) throw new Error(data.error || 'Photo search failed');
  return data;
}

// Looks up photos two at a time (gentle on the free Unsplash limit) and reports each one as soon as it is found.
export async function addPhotos(recipes, onPhoto) {
  const queue = recipes.filter((r) => !r.image);
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      try {
        onPhoto(r.id, await findPhoto(r));
      } catch {
        // No key, limit reached or nothing found: the recipe keeps its emoji card.
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
