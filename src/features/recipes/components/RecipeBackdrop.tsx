import nutritionBg from '../../../assets/nutrition-bg.jpg'

/**
 * Header backdrop for the Food page — a bundled nutrition flat-lay (shipped in
 * the repo under src/assets, NOT hotlinked). Static and always present so the
 * header reads as a proper food banner; RecipesPage overlays a cream gradient
 * on top for text contrast. Replaced the old rotating recipe-cover-image
 * treatment (sparse / low-quality for users with few recipe photos) with one
 * consistent, always-good image per user request.
 */
export function RecipeBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <img src={nutritionBg} alt="" className="absolute inset-0 w-full h-full object-cover object-center opacity-70" />
    </div>
  )
}
