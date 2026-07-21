import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type {
	TemplateColorRoles,
	TemplateFeatureStyleSlots,
	TemplateFeatures,
	TemplateStyleContext,
	TemplateStyleSlots,
} from "../shared/types";
import { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { Image, Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { createBaseTemplateStyles } from "../shared/base-template-styles";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { shouldShowResumeHeader } from "../shared/cover-letter";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { getTemplatePageMinHeightStyle, getTemplatePageSize } from "../shared/page-size";
import { hasTemplatePicture } from "../shared/picture";
import { Heading, Text } from "../shared/primitives";
import { createRtlStyleHelpers } from "../shared/rtl";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight, resolvePlacementColor } from "../shared/styles";

// Light neutral banner behind every section heading, echoing the FlowCV look.
const SECTION_BANNER_BACKGROUND = "#F3F4F6";

type FlareonStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	contentRow: Style;
	sidebarColumn: Style;
	mainColumn: Style;
	header: Style;
	picture: Style;
	headerIdentity: Style;
	headerName: Style;
	headerHeadline: Style;
	headerContactRow: Style;
	headerContactItem: Style;
};

type FlareonTemplate = {
	colors: TemplateColorRoles;
	styles: FlareonStyles;
	featureStyles: TemplateFeatureStyleSlots;
};

type FlareonHeaderProps = {
	styles: FlareonStyles;
};

// FlowCV-inspired: no timeline rail; each entry uses the default right-aligned date column.
const flareonFeatures = {} satisfies TemplateFeatures;

export const FlareonPage = ({ page, pageIndex }: TemplatePageProps) => {
	const data = useRender();
	const { metadata } = data;
	const { colors, styles, featureStyles } = useFlareonTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const pageSize = getTemplatePageSize(metadata.page.format);
	const pageMinHeightStyle = getTemplatePageMinHeightStyle(metadata.page.format);
	const showHeader = shouldShowResumeHeader(data, pageIndex);
	const sidebarSections = filterSections(page.sidebar, data);
	const mainSections = filterSections(page.main, data);

	return (
		<Page size={pageSize} style={composeStyles(styles.page, pageMinHeightStyle)}>
			<TemplateProvider styles={styles} featureStyles={featureStyles} colors={colors} features={flareonFeatures}>
				{showHeader && <Header styles={styles} />}

				<View style={composeStyles(styles.contentRow, { columnGap: metrics.columnGap })}>
					<View
						style={composeStyles(styles.sidebarColumn, {
							flexBasis: `${metadata.layout.sidebarWidth}%`,
							display: page.fullWidth ? "none" : "flex",
							rowGap: metrics.sectionGap,
						})}
					>
						{sidebarSections.map((section) => (
							<Section key={section} section={section} placement="sidebar" />
						))}
					</View>

					<View style={composeStyles(styles.mainColumn, { rowGap: metrics.sectionGap })}>
						{mainSections.map((section) => (
							<Section key={section} section={section} placement="main" />
						))}
					</View>
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: FlareonHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<View style={styles.header}>
			<View style={styles.headerIdentity}>
				<Heading style={styles.headerName}>{basics.name}</Heading>
				<Text style={styles.headerHeadline}>{basics.headline}</Text>

				<View style={styles.headerContactRow}>
					<EmailContactItem email={basics.email} style={styles.headerContactItem} />
					<PhoneContactItem phone={basics.phone} style={styles.headerContactItem} />
					<LocationContactItem location={basics.location} style={styles.headerContactItem} />
					<WebsiteContactItem website={basics.website} style={styles.headerContactItem} />
					{basics.customFields.map((field) => (
						<CustomFieldContactItem key={field.id} field={field} style={styles.headerContactItem} />
					))}
				</View>
			</View>

			{hasPicture && <Image src={picture.url} style={styles.picture} />}
		</View>
	);
};

const useFlareonTemplate = (): FlareonTemplate => {
	const { picture, metadata, rtl } = useRender();

	return useMemo(() => {
		const r = createRtlStyleHelpers(rtl);
		const foreground = rgbaStringToHex(metadata.design.colors.text);
		const background = rgbaStringToHex(metadata.design.colors.background);
		const primary = rgbaStringToHex(metadata.design.colors.primary);
		const colors: TemplateColorRoles = { foreground, background, primary };
		const metrics = getTemplateMetrics(metadata.page);

		const base = createBaseTemplateStyles({ metadata, foreground, r, metrics, picture });

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				flexDirection: "column",
				rowGap: metrics.headerGap,
				columnGap: metrics.columnGap,
				color: foreground,
				backgroundColor: background,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				fontFamily: metadata.typography.body.fontFamily,
				fontSize: metadata.typography.body.fontSize,
				lineHeight: metadata.typography.body.lineHeight,
				direction: r.pageDirection,
			},
			contentRow: {
				flexDirection: r.row,
			},
			sidebarColumn: {},
			mainColumn: {
				flex: 1,
			},
			// Header is a row: identity block on the leading edge, circular photo on the trailing edge.
			header: {
				flexDirection: r.row,
				alignItems: "center",
				justifyContent: "space-between",
				columnGap: metrics.gapX(1),
			},
			headerIdentity: {
				flex: 1,
				rowGap: metrics.gapY(0.35),
				...r.text,
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 2,
				lineHeight: headerNameLineHeight,
				fontWeight: metadata.typography.heading.fontWeights.at(-1) ?? "700",
				color: primary,
			},
			headerHeadline: {
				color: primary,
				fontSize: metadata.typography.body.fontSize * 1.125,
			},
			headerContactRow: {
				flexDirection: r.row,
				flexWrap: "wrap",
				marginTop: metrics.gapY(0.25),
				rowGap: metrics.gapY(0.25),
				columnGap: metrics.gapX(0.75),
			},
			headerContactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			// Centered banner bar behind each section title.
			sectionHeading: {
				color: primary,
				backgroundColor: SECTION_BANNER_BACKGROUND,
				paddingVertical: metrics.gapY(0.35),
				paddingHorizontal: metrics.gapX(0.5),
				borderRadius: 2,
				fontWeight: metadata.typography.heading.fontWeights.at(-1) ?? "700",
			},
			sectionHeadingContainer: {
				justifyContent: "center",
				alignItems: "center",
			},
		});

		const foregroundFor = ({ placement, colors }: TemplateStyleContext) =>
			resolvePlacementColor({
				placement,
				defaultForeground: colors.foreground,
				sidebarForeground: colors.sidebarForeground,
			});

		const accentFor = ({ placement, colors }: TemplateStyleContext) =>
			resolvePlacementColor({
				placement,
				defaultForeground: colors.primary,
				sidebarForeground: colors.sidebarForeground,
			});

		const featureStyles = {} satisfies TemplateFeatureStyleSlots;

		return {
			colors,
			featureStyles,
			styles: {
				...baseStyles,
				text: (context) => ({ ...baseStyles.text, color: foregroundFor(context) }),
				heading: (context) => ({ ...baseStyles.heading, color: foregroundFor(context) }),
				link: (context) => ({ ...baseStyles.link, color: foregroundFor(context) }),
				richParagraph: (context) => ({ ...baseStyles.richParagraph, color: foregroundFor(context) }),
				richListItemMarker: (context) => ({ ...baseStyles.richListItemMarker, color: foregroundFor(context) }),
				richListItemContent: (context) => ({ ...baseStyles.richListItemContent, color: foregroundFor(context) }),
				sectionHeading: (context) => ({ ...baseStyles.sectionHeading, color: accentFor(context) }),
				sectionHeadingIcon: (context) => ({
					color: accentFor(context),
				}),
				icon: (context) => ({
					display: metadata.page.hideIcons ? "none" : "flex",
					size: metadata.typography.body.fontSize,
					color: accentFor(context),
				}),
			} satisfies FlareonStyles,
		};
	}, [picture, metadata, rtl]);
};
