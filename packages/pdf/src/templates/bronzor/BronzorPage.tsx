import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateStyleSlots } from "../shared/types";
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for the server's classic JSX transform.
import React, { useMemo } from "react";
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
import { composeStyles, headerNameLineHeight } from "../shared/styles";

type BronzorStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	headerContactRow: Style;
	headerContactItem: Style;
	sections: Style;
};

type BronzorTemplate = {
	colors: TemplateColorRoles;
	styles: BronzorStyles;
};

type BronzorHeaderProps = {
	styles: BronzorStyles;
};

const getBronzorSections = ({
	mainSections,
	sidebarSections,
	fullWidth,
}: {
	mainSections: string[];
	sidebarSections: string[];
	fullWidth: boolean;
}) => {
	if (fullWidth) return mainSections;

	const sections: string[] = [];
	const sectionCount = Math.max(mainSections.length, sidebarSections.length);

	for (let index = 0; index < sectionCount; index += 1) {
		const sidebarSection = sidebarSections[index];
		const mainSection = mainSections[index];

		if (sidebarSection) sections.push(sidebarSection);
		if (mainSection) sections.push(mainSection);
	}

	return sections;
};

export const BronzorPage = ({ page, pageIndex }: TemplatePageProps) => {
	const data = useRender();
	const { metadata } = data;
	const { styles, colors } = useBronzorTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const pageSize = getTemplatePageSize(metadata.page.format);
	const pageMinHeightStyle = getTemplatePageMinHeightStyle(metadata.page.format);
	const showHeader = shouldShowResumeHeader(data, pageIndex);
	const sidebarSections = filterSections(page.sidebar, data);
	const mainSections = filterSections(page.main, data);
	const sections = getBronzorSections({ mainSections, sidebarSections, fullWidth: page.fullWidth });

	return (
		<Page size={pageSize} style={composeStyles(styles.page, pageMinHeightStyle)}>
			<TemplateProvider styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<View style={composeStyles(styles.sections, { rowGap: metrics.sectionGap })}>
					{sections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: BronzorHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<View style={styles.header}>
			{hasPicture && <Image src={picture.url} style={styles.picture} />}

			<View style={styles.headerTitle}>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					<Text>{basics.headline}</Text>
				</View>
			</View>

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
	);
};

const useBronzorTemplate = (): BronzorTemplate => {
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
			heading: { ...base.heading, fontWeight: metadata.typography.heading.fontWeights[0] ?? "500" },
			page: {
				flexDirection: "column",
				rowGap: metrics.headerGap,
				color: foreground,
				backgroundColor: background,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				fontFamily: metadata.typography.body.fontFamily,
				fontSize: metadata.typography.body.fontSize,
				lineHeight: metadata.typography.body.lineHeight,
				direction: r.pageDirection,
			},
			section: {
				flexDirection: r.row,
				columnGap: metrics.columnGap,
				borderTopWidth: 1,
				borderTopColor: primary,
				paddingTop: metrics.gapY(0.5),
			},
			sectionHeading: {
				width: `${metadata.layout.sidebarWidth}%`,
				flexShrink: 0,
				fontSize: metadata.typography.heading.fontSize * 0.75,
				color: primary,
				textAlign: r.sectionHeadingTextAlign,
			},
			sectionItems: {
				flex: 1,
			},
			sections: {
				flexDirection: "column",
			},
			header: {
				alignItems: "center",
				rowGap: metrics.gapY(0.5),
			},
			headerTitle: {
				alignItems: "center",
				textAlign: "center",
			},
			headerIdentity: {
				alignItems: "center",
				textAlign: "center",
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
			},
			headerContactRow: {
				justifyContent: "center",
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(5 / 6),
			},
			headerContactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(0.25),
			},
			icon: {
				display: metadata.page.hideIcons ? "none" : "flex",
				size: metadata.typography.body.fontSize,
				color: primary,
			},
		});

		return { colors, styles: baseStyles satisfies BronzorStyles };
	}, [picture, metadata, rtl]);
};
