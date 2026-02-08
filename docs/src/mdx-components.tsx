// biome-ignore lint/performance/noNamespaceImport: keep it as is from official documentation
import * as TabsComponents from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
// biome-ignore lint/performance/noNamespaceImport: keep it as is from official documentation
import * as icons from "lucide-react";
import type { MDXComponents } from "mdx/types";
import { Mermaid } from "@/components/mdx/mermaid";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...(icons as unknown as MDXComponents),
    ...defaultMdxComponents,
    ...TabsComponents,
    Mermaid,
    ...components,
  };
}
