\# Original Project Prompt



This document preserves the original project prompt that started the sales forecasting AI proof of concept.



> I've just created this folder to start a proof of concept project, but I'd like to confirm some ideas on architecture, first.

> The overall goal is to have a basic webapp which helps demonstrate the use of AI in sales forecasting.  The product is fragrance.  The business which would use this app is a fragrance distributor, whose customers are typically brick and mortar retailers, usually Department Stores. Assume the business is US based.

> The plan is use it as an extension of an ERP system so that my users can use it for recommendations on how to adjust a sales foreast to prepare for the upcoming sales season.

> The user will upload an Excel Workbook with 4 Sheets.  Each sheet will have column Headings starting on row 2, and several rows of data will begin on row 3.  Each sheet will have an item code in column A.  The name of the Excel Workbook will be ForecastsYYYYMM.xls, where YYYY is the year and MM is the starting month of the forecast. The data will prepared within the context of the specific month indicated in the name of the Excel file. For example, Forecasts202505.xls will contain a 13 month forecast starting in May, 2025.  A sample of the Excel Workbook is in the data folder.

> The Excel Workbook will contain the following sheets:
> - Items, with the Item Code in Column A, and the remaining columns showing item-specific attributes such as Brand, Category, Gender, Type, Size, Description, and Retail Price.  Note that some items have a blank or 0 retail price - these are samples or testers that are frequently shipped to brick and morter retailers to help promote sales at the fragrance counter.
> - Shipments History, with the Item Code in Column A, and the remaining columns showing units shipped in the past 12 months.  These column headings are formatted as SYYMM where S means Shipped, YY is the year (where 25 is 2025), and MM is the month (where 07 is July).
> - Forecasts, with the Item Code in Column A, and the remaining columns showing units forcasted for the next 12 months.  These column headings are formatted as FYYMM where F means Forecast, YY is the year (where 26 is 2026), and MM is the month (where 07 is July).
> - Forecast History, with the Item Code in Column A, and the remainging columns showing the unit forcast for the past 12 months, ending last month.  These column headings are formatted  HYYMM where H means Forecast History, YY is the year (where 25 is 2025), and MM is the month (where 07 is July).

> The POC part of this, though, is how I'd like to integrate AI into this.

> The app should be built with Angular, and use igniteUI components for all UI controls, grids, chartes, etc.

>

> After the Excel file is uploaded, I'd like to visualize the forecast data as a table, and I'd like to select a product in the table to visualize the forecast vs the shipments history last year vs the forecast history last year on a line graph.

> And in this exploration view, I'd like a button I can click: "AI-Assisted Forecasting" which will provide me with insights that go beyond my own considerations that could impect my forecasts.

> When I click this button, I'd like a modal window to show up, informing me how to use it.

> I should explain how my forecasting works, and what considerations I took in making my predictions.

> Optionally, this is the opportunity I have to include particular details that I realize are in my blindspot, and I specifically would like consideration in those areas.

> And upon submission, I wait for an async AI task to finish, which will go month-by-month, product-by-product on my forecast to fetch possible influential factors that I should consider in my forecast.

> Maybe these factors are numerable and directly tie into dollar-impact. Maybe they're impossible to quantify, but they're important to at least keep in mind when adjusting the forecast in anticpation of increased or decreased demand, and the timing for purchase order delivery when flowing the forecast in my demand planning system.

> My user would like to see the following:
> - the people, places and things that might influence demand for these forecasted fragramce items
> - sentiment analysis on trends that might impact retail sales in general or for a particular month
> - suggestions and out-of-the box recommendations which may promote retail sales

>

> These suggestions may be correlated using the metadata attributed to the items in the item master sheet.


> Metadata that describes more about the product than can be conveyed by the name alone.

>

> For example, one of my products may be a perfume.

> Including the name alone may be informative enough to help an agent look up what the product is, how it's been marketed in the past, and if those marketing concepts are getting popular again independently--like a famous actor-partner launching a new movie; their popularity may impact sales positively.

> Something that may not be easy to find is that perhaps the liquid is a very fine amber color; that could be included as descriptive info/metadata. And if Amber or something close is the color of the year, maybe that's something worth leaning into! A suggestion to improve sales!

> And perhaps, if I mention that it's sold in Minnesota, and this month, there's been political unrest in the state, next month may still be negatively impacted due to the affiliation.

>

> Something along those lines.

>

> Once these findings are found, the agent should report their findings in a normalized structure:

>

> - item (string)

> - month-year (string isoformatted)

> - considerations (array\[object(description:str, impact:int)])

> - recommendations (array\[object(description:str, impact:int)])

>

> These values will eventually be pushed into a database, and I will provide API details for saving these findings in a future specification.

> Let's get started with an implementation plan.

> I'd like this to be in a `docs/` directory in this project, and any diagrams to be made using mermaid.

