import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Facebook, Instagram, Twitter, Youtube, Wrench } from "lucide-react";
import { PageHero } from "@/components/sections/PageHero";
import { categories } from "@/data/site";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — Sammy Store Logs" },
      {
        name: "description",
        content:
          "Browse verified social media account categories: Aged Twitter, Instagram, Facebook, Tools and more.",
      },
      { property: "og:title", content: "Our Products" },
      {
        property: "og:description",
        content: "Verified accounts across all major social media platforms.",
      },
    ],
  }),
  component: ProductsPage,
});

const platformIcons: Record<string, React.ElementType> = {
  "aged-twitter": Twitter,
  "aged-instagram": Instagram,
  "random-facebook": Facebook,
  "usa-facebook": Facebook,
  tools: Wrench,
  "working-profiles": Instagram,
  "below-50-friend": Facebook,
};

function ProductsPage() {
  return (
    <>
      <PageHero
        title="Our Products"
        subtitle="Verified accounts across every major social platform."
        breadcrumbs={[{ name: "Products" }]}
      />

      <section className="w-full bg-background py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-brand-navy mb-3 tracking-tight">
              Browse our categories
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              A wide range of verified social media accounts ready for immediate transfer.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {categories.map((category, index) => {
              const Icon = platformIcons[category.slug] ?? Facebook;
              return (
                <motion.div
                  key={category.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="group bg-card rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all border border-border"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-14 h-14 bg-brand-orange/10 rounded-2xl flex items-center justify-center group-hover:bg-brand-orange transition-colors">
                      <Icon className="w-6 h-6 text-brand-orange group-hover:text-white transition-colors" />
                    </div>
                    <span className="text-xs font-medium text-green-700 bg-green-100 px-3 py-1 rounded-full">
                      Available
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-brand-navy mb-2 group-hover:text-brand-orange transition-colors">
                    {category.name}
                  </h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Browse verified {category.name.toLowerCase()} accounts ready for transfer.
                  </p>
                  <Link
                    to="/contact"
                    className="inline-flex items-center gap-2 text-brand-orange hover:text-brand-orange-hover font-medium text-sm transition-colors"
                  >
                    Request access
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="w-full bg-brand-navy py-16 md:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-4 tracking-tight">
            Can't find what you're looking for?
          </h2>
          <p className="text-white/70 max-w-2xl mx-auto mb-8">
            Contact our support team and we'll help you find the perfect account.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 bg-brand-orange hover:bg-brand-orange-hover text-white px-8 py-4 rounded-lg font-semibold transition-colors"
          >
            Contact Support
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </>
  );
}
