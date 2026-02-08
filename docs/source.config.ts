import { remarkNpm } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

const remarkNpmOptions = {
  persist: {
    id: "package-manager-selection",
  },
};

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [[remarkNpm, remarkNpmOptions]],
  },
});
